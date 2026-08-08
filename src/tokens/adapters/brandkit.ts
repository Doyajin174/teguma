/**
 * canonical → BrandKit / DesignDocument projection (명세 6.2).
 *
 * - mode 해석은 4.2 규칙(요청 mode → default → missing-mode). light↔dark 교차
 *   fallback 없음.
 * - palette: color 토큰만. 요청 mode·default 모두 없으면 loss.ambiguous
 *   (missing-mode) 보고 후 생략 — 기존 SEED default 호출 정책 유지.
 * - fonts: fontFamily + fontWeight 토큰. family↔weight 연관이 없으면
 *   loss.lossy("합집합 등록 — 기존 POC 한계") 명시.
 * - BrandKit이 표현하지 못하는 타입/kind는 loss.unsupported (6.2).
 * - DesignDocument는 기존 buildSeedDocument 로직을 projection의 별도 단계로
 *   일반화한 대표 문서 생성이다(대표 문서 정책은 v0.2에서 문서화).
 * - canonical 문서는 수정하지 않는다(6.1) — 손실은 결과의 loss에 귀속.
 */

import { applyBrandKit } from "../../design/brand-kit.js";
import { parseDesignDocument } from "../../design/document.js";
import type { BrandKit, BrandColor, DesignDocument } from "../../design/document.js";
import {
  emptyLossManifest,
  resolveTokenModeValue,
  sortImportLoss,
  type ProjectionMode,
  type ProjectionResult,
} from "../canonical.js";
import type {
  CanonicalLossItem,
  CanonicalScalar,
  CanonicalToken,
  CanonicalTokenDocument,
  ColorStruct,
} from "../schema.js";

export interface BrandKitProjectionParams {
  /** 필수 — 4.2 mode 해석 기준. */
  mode: ProjectionMode;
  kitId?: string;
  kitName?: string;
}

const DOCUMENT_CANVAS_WIDTH = 480;
const DOCUMENT_CANVAS_HEIGHT = 320;

function lastPathSegment(path: string): string {
  return path.split(".").at(-1) ?? path;
}

/** BrandKit IdentifierSchema 호환 id(path 유래, 결정적). */
function safeProjectId(path: string): string {
  let id = path
    .replace(/^\$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "");
  if (id === "") id = "t";
  return id;
}

function asColorStruct(scalar: CanonicalScalar): ColorStruct | undefined {
  const value = scalar.value;
  if (typeof value === "object" && value !== null && !Array.isArray(value) && "colorSpace" in value) {
    return value as ColorStruct;
  }
  return undefined;
}

function scalarNumber(scalar: CanonicalScalar): number | undefined {
  return typeof scalar.value === "number" ? scalar.value : undefined;
}

function scalarString(scalar: CanonicalScalar): string | string[] | undefined {
  if (typeof scalar.value === "string") return scalar.value;
  if (Array.isArray(scalar.value) && scalar.value.every((item) => typeof item === "string")) {
    return scalar.value as string[];
  }
  return undefined;
}

/** 4.2 mode 해석 실패를 loss 항목으로 기록한다(공통). */
function pushResolutionLoss(
  loss: { unsupported: CanonicalLossItem[]; ambiguous: CanonicalLossItem[]; lossy: CanonicalLossItem[] },
  token: CanonicalToken,
  mode: ProjectionMode,
  resolution: ReturnType<typeof resolveTokenModeValue>,
  ambiguousCode: string,
): void {
  if (resolution.kind === "missing") {
    loss.ambiguous.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: ambiguousCode,
      reason: "요청 mode·default 모두 없음 — light↔dark 교차 fallback 금지",
    });
  } else if (resolution.kind === "unresolved") {
    loss.lossy.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: "unresolved-token",
      reason: "alias 미해석 — 값 없음",
    });
  }
}

/** canonical → BrandKit projection (6.2). BrandKit 구성 불가 시 value는 null. */
export function projectToBrandKit(
  doc: CanonicalTokenDocument,
  params: BrandKitProjectionParams,
): ProjectionResult<BrandKit | null> {
  const loss = emptyLossManifest();
  const palette: BrandColor[] = [];
  const families: string[] = [];
  const weights: number[] = [];

  for (const token of doc.tokens) {
    if (token.type === "color") {
      const resolution = resolveTokenModeValue(token, params.mode);
      if (resolution.kind !== "ok") {
        pushResolutionLoss(loss, token, params.mode, resolution, "missing-mode");
        continue;
      }
      const colorStruct = asColorStruct(resolution.value.resolvedValue);
      const hex = colorStruct?.hex;
      if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          mode: params.mode,
          code: "invalid-color",
          reason: "ColorStruct에 #RRGGBB hex가 없음 — palette 생략",
          raw: resolution.value.resolvedValue,
        });
        continue;
      }
      palette.push({
        id: safeProjectId(token.path),
        name: token.name ?? lastPathSegment(token.path),
        value: hex.toLowerCase(),
      });
      continue;
    }

    if (token.type === "fontFamily") {
      const resolution = resolveTokenModeValue(token, params.mode);
      if (resolution.kind !== "ok") {
        pushResolutionLoss(loss, token, params.mode, resolution, "missing-mode");
        continue;
      }
      const family = scalarString(resolution.value.resolvedValue);
      if (family === undefined) {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          mode: params.mode,
          code: "invalid-font-family",
          reason: "fontFamily 값이 문자열(배열)이 아님",
        });
        continue;
      }
      families.push(...(Array.isArray(family) ? family : [family]));
      continue;
    }

    if (token.type === "fontWeight") {
      const resolution = resolveTokenModeValue(token, params.mode);
      if (resolution.kind !== "ok") {
        pushResolutionLoss(loss, token, params.mode, resolution, "missing-mode");
        continue;
      }
      const weight = scalarNumber(resolution.value.resolvedValue);
      if (weight === undefined || !Number.isInteger(weight) || weight < 100 || weight > 900) {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          mode: params.mode,
          code: "invalid-font-weight",
          reason: "fontWeight 값이 100..900 정수가 아님 — BrandKit 스키마 범위",
        });
        continue;
      }
      weights.push(weight);
      continue;
    }

    // BrandKit이 표현하지 못하는 타입/kind → loss.unsupported (6.2)
    loss.unsupported.push({
      tokenId: token.id,
      path: token.path,
      code: "unsupported-type",
      reason: `BrandKit은 ${token.type}${token.kind !== undefined ? ` (kind: ${token.kind})` : ""}을 표현하지 못함`,
    });
  }

  const uniqueFamilies = [...new Set(families)];
  const uniqueWeights = [...new Set(weights)].sort((a, b) => a - b);
  if (palette.length > 0 && uniqueFamilies.length > 0 && uniqueWeights.length > 0) {
    // family↔weight 연관 없음 → 합집합 등록 (기존 POC 한계, 6.2)
    loss.lossy.push({
      path: "fonts",
      code: "weight-union",
      reason: "family↔weight 연관 없음 — 전체 weight 합집합 등록 — 기존 POC 한계",
    });
  }

  const value: BrandKit | null =
    palette.length > 0 && uniqueFamilies.length > 0 && uniqueWeights.length > 0
      ? {
          id: params.kitId ?? `canonical-${doc.document.sourceAdapter}`,
          name: params.kitName ?? doc.document.sourceName,
          palette,
          fonts: uniqueFamilies.map((family) => ({ family, weights: uniqueWeights })),
          logos: [],
        }
      : null;

  return { value, loss: sortImportLoss(loss) };
}

export interface DesignDocumentProjectionParams {
  /** 필수 — 4.2 mode 해석 기준. */
  mode: ProjectionMode;
  kitId?: string;
  kitName?: string;
}

/**
 * canonical → 대표 DesignDocument projection (6.2).
 * 기존 buildSeedDocument(seed.ts)의 필수 토큰·레이아웃을 canonical 조회로
 * 일반화한다. 필수 토큰이 없으면 null + loss.
 */
export function projectToDesignDocument(
  doc: CanonicalTokenDocument,
  params: DesignDocumentProjectionParams,
): ProjectionResult<DesignDocument | null> {
  const brandProjection = projectToBrandKit(doc, params);
  if (brandProjection.value === null) {
    return { value: null, loss: brandProjection.loss };
  }

  const loss = brandProjection.loss;
  const byPath = new Map(doc.tokens.map((token) => [token.path, token]));
  const required: Array<{ path: string; key: "gutter" | "fontSize" | "lineHeight" | "family" | "weight" | "textColor" | "background" }> = [
    { path: "$dimension.spacing-x.global-gutter", key: "gutter" },
    { path: "$font-size.t1", key: "fontSize" },
    { path: "$line-height.t1", key: "lineHeight" },
    { path: "$font-family.display", key: "family" },
    { path: "$font-weight.regular", key: "weight" },
    { path: "$color.palette.carrot-600", key: "textColor" },
    {
      path: params.mode === "dark" ? "$color.palette.gray-00" : "$color.palette.gray-1000",
      key: "background",
    },
  ];

  const values: Partial<Record<"gutter" | "fontSize" | "lineHeight" | "family" | "weight" | "textColor" | "background", number | string>> = {};
  // line-height는 단위 유무로 의미가 다르다(4.5): px → fontSize로 나눠 비율화,
  // 단위 없는 number는 이미 비율 — 그대로 사용.
  let lineHeightIsPx = false;
  for (const requirement of required) {
    const token = byPath.get(requirement.path);
    const resolution = token === undefined ? undefined : resolveTokenModeValue(token, params.mode);
    if (token === undefined || resolution === undefined || resolution.kind !== "ok") {
      loss.lossy.push({
        ...(token !== undefined ? { tokenId: token.id } : {}),
        path: requirement.path,
        code: "missing-document-token",
        reason: "대표 문서에 필요한 토큰이 없거나 해석 불가",
      });
      continue;
    }
    const scalar = resolution.value.resolvedValue;
    if (requirement.key === "family") {
      const family = scalarString(scalar);
      if (family !== undefined && !Array.isArray(family)) values.family = family;
    } else if (requirement.key === "textColor" || requirement.key === "background") {
      const colorStruct = asColorStruct(scalar);
      if (colorStruct?.hex !== undefined && /^#[0-9a-f]{6}$/i.test(colorStruct.hex)) {
        values[requirement.key] = colorStruct.hex.toLowerCase();
      }
    } else {
      const number = scalarNumber(scalar);
      if (number !== undefined) {
        values[requirement.key] = number;
        if (requirement.key === "lineHeight" && scalar.unit === "px") lineHeightIsPx = true;
      }
    }
  }

  if (
    values.gutter === undefined
    || values.fontSize === undefined
    || values.lineHeight === undefined
    || values.family === undefined
    || values.weight === undefined
    || values.textColor === undefined
    || values.background === undefined
  ) {
    return { value: null, loss: sortImportLoss(loss) };
  }

  const letterSpacingToken = byPath.get("$letter-spacing.t1");
  const letterSpacingResolution = letterSpacingToken === undefined
    ? undefined
    : resolveTokenModeValue(letterSpacingToken, params.mode);
  const letterSpacing =
    letterSpacingResolution !== undefined
    && letterSpacingResolution.kind === "ok"
    && scalarNumber(letterSpacingResolution.value.resolvedValue) !== undefined
      ? scalarNumber(letterSpacingResolution.value.resolvedValue) as number
      : 0;

  const gutter = values.gutter as number;
  const fontSize = values.fontSize as number;
  const lineHeightValue = values.lineHeight as number;
  const family = values.family as string;
  const weight = values.weight as number;
  const textColor = values.textColor as string;
  const background = values.background as string;
  const modeSuffix = params.mode === "default" ? "default" : params.mode;

  const document = parseDesignDocument({
    id: `seed-poc-${modeSuffix}`,
    title: `SEED POC (${params.mode})`,
    canvas: {
      width: DOCUMENT_CANVAS_WIDTH,
      height: DOCUMENT_CANVAS_HEIGHT,
      unit: "px",
      safeMargin: gutter,
    },
    brandKit: brandProjection.value,
    pages: [
      {
        id: "page-1",
        name: "Seed POC",
        background,
        layers: [
          {
            id: "seed-band",
            type: "rect",
            frame: {
              x: gutter,
              y: gutter,
              width: DOCUMENT_CANVAS_WIDTH - (gutter * 2),
              height: 96,
            },
            fill: textColor,
            radius: 0,
            opacity: 1,
          },
          {
            id: "seed-copy",
            type: "text",
            frame: {
              x: gutter,
              y: 96 + (gutter * 2),
              width: DOCUMENT_CANVAS_WIDTH - (gutter * 2),
              height: 48,
            },
            text: "SEED POC",
            fontFamily: family,
            fontSize,
            fontWeight: weight,
            color: textColor,
            align: "start",
            lineHeight: lineHeightIsPx ? lineHeightValue / fontSize : lineHeightValue,
            letterSpacing,
            opacity: 1,
          },
        ],
      },
    ],
  });

  return { value: applyBrandKit(document, brandProjection.value), loss: sortImportLoss(loss) };
}

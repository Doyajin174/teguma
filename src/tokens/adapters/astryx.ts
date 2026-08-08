/**
 * canonical → Astryx theme draft projection (명세 6.3).
 *
 * - 출력은 기존 AstryxThemeDraft를 유지하고 별도 modes wrapper가 필요 없다 —
 *   canonical values에서 mode를 직접 채운다(4.2 해석 규칙).
 * - semanticRole.confidence === "explicit" 토큰만 COLOR_ROLE_REGISTRY 매칭을
 *   시도한다. `mapped`(Penpot 추론)는 자동 매핑 금지 → role 미전달로
 *   MISSING_ROLE unmapped 처리(현행 no-guess 원칙 유지).
 * - roleOverrides는 canonical token id(logical) 참조 — 기존 이름 문자열 의존 제거.
 * - 충돌(M3) → mapping.status "conflict" + loss.ambiguous 병기.
 * - mode 누락 → loss.ambiguous(code missing-light/missing-dark — 4.2 기본 code
 *   missing-mode의 Astryx 세분 code). 기존 MISSING_DARK_MODE/MISSING_LIGHT_MODE
 *   경고는 이 경로에서 loss로 대체한다.
 * - typography/spacing은 현행 규칙 유지(4/8 base unit, 단조 증가·배수 검사).
 * - canonical 문서는 수정하지 않는다(6.1) — 손실은 결과의 loss에 귀속.
 */

import {
  convertPenpotTokensToAstryx,
  type AstryxThemeDraft,
  type AstryxThemeInput,
} from "../../design/astryx-theme.js";
import type { CompressedColor, CompressedTypography } from "../../penpot/types.js";
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

export interface AstryxProjectionParams {
  baseTheme?: string;
  /** canonical token id(logical) 참조 role override — 6.3. */
  roleOverrides?: Array<{ token: string; role: string }>;
}

function lastPathSegment(path: string): string {
  return path.split(/[./]/).at(-1) ?? path;
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

type LossSink = {
  unsupported: CanonicalLossItem[];
  ambiguous: CanonicalLossItem[];
  lossy: CanonicalLossItem[];
};

/** 4.2 해석 실패 → mode별 세분 code(missing-light/missing-dark) 또는 unresolved. */
function pushResolutionLoss(
  loss: LossSink,
  token: CanonicalToken,
  mode: ProjectionMode,
  resolution: ReturnType<typeof resolveTokenModeValue>,
): void {
  if (resolution.kind === "missing") {
    loss.ambiguous.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: mode === "light" ? "missing-light" : "missing-dark",
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

function consumeColor(
  loss: LossSink,
  token: CanonicalToken,
  mode: "light" | "dark",
  overrideRoles: Map<string, string>,
  colors: CompressedColor[],
): void {
  const resolution = resolveTokenModeValue(token, mode);
  if (resolution.kind !== "ok") {
    pushResolutionLoss(loss, token, mode, resolution);
    return;
  }
  const colorStruct = asColorStruct(resolution.value.resolvedValue);
  if (colorStruct === undefined || colorStruct.hex === undefined || !/^#[0-9a-f]{6}$/i.test(colorStruct.hex)) {
    loss.lossy.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: "invalid-color",
      reason: "ColorStruct에 #RRGGBB hex가 없음",
      raw: resolution.value.resolvedValue,
    });
    return;
  }
  const normalizedHex = colorStruct.hex.toLowerCase();
  // 6.3: explicit만 registry 매칭. mapped/unknown은 role 미전달 → MISSING_ROLE unmapped.
  const override = overrideRoles.get(token.id);
  const role = override ?? (token.semanticRole?.confidence === "explicit" ? token.semanticRole.role : undefined);
  colors.push({
    name: token.path,
    value: normalizedHex,
    ...(role !== undefined ? { role } : {}),
  });
  if (colorStruct.alpha !== undefined && colorStruct.alpha < 1) {
    loss.lossy.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: "alpha-dropped",
      reason: "불투명도는 Astryx draft v0.1에 미표현 — hex만 사용",
      original: colorStruct,
      converted: { value: normalizedHex },
    });
  }
}

function consumeSpacing(
  loss: LossSink,
  token: CanonicalToken,
  mode: "light" | "dark",
  values: number[],
): void {
  const resolution = resolveTokenModeValue(token, mode);
  if (resolution.kind !== "ok") {
    pushResolutionLoss(loss, token, mode, resolution);
    return;
  }
  const number = scalarNumber(resolution.value.resolvedValue);
  if (number === undefined) {
    loss.lossy.push({
      tokenId: token.id,
      path: token.path,
      mode,
      code: "invalid-spacing-value",
      reason: "spacing 값이 숫자가 아님",
    });
    return;
  }
  values.push(number);
}

/**
 * canonical → Astryx theme draft projection (6.3).
 * 기존 convertPenpotTokensToAstryx를 엔진으로 재사용해 출력 형태를 유지한다.
 */
export function projectToAstryxTheme(
  doc: CanonicalTokenDocument,
  params: AstryxProjectionParams = {},
): ProjectionResult<AstryxThemeDraft> {
  const loss = emptyLossManifest();
  const idByPath = new Map(doc.tokens.map((token) => [token.path, token.id]));
  // 엔진은 roleOverride 대상 토큰을 color name(= canonical path)으로 매칭한다
  // (indexRoleOverrides). canonical id(logical) 참조를 path로 되돌린다.
  const pathById = new Map(doc.tokens.map((token) => [token.id, token.path]));
  const overrideRoles = new Map((params.roleOverrides ?? []).map((o) => [o.token, o.role]));

  const lightColors: CompressedColor[] = [];
  const darkColors: CompressedColor[] = [];
  const lightSpacing: number[] = [];
  const darkSpacing: number[] = [];
  const typographyTokens: CanonicalToken[] = [];
  const letterSpacingTokens: CanonicalToken[] = [];

  for (const token of doc.tokens) {
    switch (token.type) {
      case "color":
        consumeColor(loss, token, "light", overrideRoles, lightColors);
        consumeColor(loss, token, "dark", overrideRoles, darkColors);
        break;
      case "dimension":
        if (token.kind === "spacing") {
          consumeSpacing(loss, token, "light", lightSpacing);
          consumeSpacing(loss, token, "dark", darkSpacing);
        } else if (token.kind === "font-size") {
          typographyTokens.push(token);
        } else if (token.kind === "line-height") {
          typographyTokens.push(token);
        } else if (token.kind === "letter-spacing") {
          letterSpacingTokens.push(token);
        } else {
          loss.unsupported.push({
            tokenId: token.id,
            path: token.path,
            code: "unsupported-type",
            reason: "Astryx draft v0.1이 표현하지 못하는 dimension 토큰",
          });
        }
        break;
      case "number":
        if (token.kind === "line-height") {
          typographyTokens.push(token);
        } else {
          loss.unsupported.push({
            tokenId: token.id,
            path: token.path,
            code: "unsupported-type",
            reason: "Astryx draft v0.1이 표현하지 못하는 number 토큰",
          });
        }
        break;
      case "fontFamily":
      case "fontWeight":
        typographyTokens.push(token);
        break;
      default:
        loss.unsupported.push({
          tokenId: token.id,
          path: token.path,
          code: "unsupported-type",
          reason: `Astryx draft v0.1이 표현하지 못하는 ${token.type} 토큰`,
        });
    }
  }

  // letter-spacing은 draft에 미표현 — lossy로 구조화 보고(원칙 4)
  for (const token of letterSpacingTokens) {
    loss.lossy.push({
      tokenId: token.id,
      path: token.path,
      code: "dropped-property",
      reason: "letterSpacing은 Astryx draft v0.1에 미표현",
    });
  }

  // ── typography 재구성 (mode 무관 — 4.2의 light → default 해석) ──────────────
  const families: string[] = [];
  const scale: CompressedTypography["scale"] = [];
  const fontSizes = typographyTokens.filter(
    (token) => token.type === "dimension" && token.kind === "font-size",
  );
  const lineHeights = typographyTokens.filter(
    (token) => token.kind === "line-height",
  );
  const weights = typographyTokens.filter((token) => token.type === "fontWeight");

  for (const token of typographyTokens) {
    if (token.type === "fontFamily") {
      const resolution = resolveTokenModeValue(token, "light");
      if (resolution.kind !== "ok") {
        if (resolution.kind === "missing") {
          loss.lossy.push({
            tokenId: token.id,
            path: token.path,
            code: "missing-typography-mode",
            reason: "light/default mode 없음 — 타이포그래피 미반영",
          });
        } else {
          loss.lossy.push({
            tokenId: token.id,
            path: token.path,
            code: "unresolved-token",
            reason: "alias 미해석 — 값 없음",
          });
        }
        continue;
      }
      const family = scalarString(resolution.value.resolvedValue);
      if (family === undefined) {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          code: "invalid-font-family",
          reason: "fontFamily 값이 문자열(배열)이 아님",
        });
        continue;
      }
      families.push(...(Array.isArray(family) ? family : [family]));
    }
  }

  const fontSizeNames = new Set<string>();
  for (const token of fontSizes) {
    const resolution = resolveTokenModeValue(token, "light");
    if (resolution.kind !== "ok") {
      if (resolution.kind === "missing") {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          code: "missing-typography-mode",
          reason: "light/default mode 없음 — 타이포그래피 미반영",
        });
      } else {
        loss.lossy.push({
          tokenId: token.id,
          path: token.path,
          code: "unresolved-token",
          reason: "alias 미해석 — 값 없음",
        });
      }
      continue;
    }
    const size = scalarNumber(resolution.value.resolvedValue);
    if (size === undefined || !Number.isFinite(size) || size <= 0) {
      loss.lossy.push({
        tokenId: token.id,
        path: token.path,
        code: "invalid-font-size",
        reason: "font-size 값이 양수가 아님",
      });
      continue;
    }
    const name = lastPathSegment(token.path);
    fontSizeNames.add(name);

    // 같은 이름의 line-height/weight 토큰과 연관 (결정적 — 문서 정렬 순서)
    const lineHeightToken = lineHeights.find(
      (candidate) => lastPathSegment(candidate.path) === name,
    );
    const lineHeightResolution = lineHeightToken === undefined
      ? undefined
      : resolveTokenModeValue(lineHeightToken, "light");
    const lineHeight = lineHeightResolution !== undefined
      && lineHeightResolution.kind === "ok"
      && scalarNumber(lineHeightResolution.value.resolvedValue) !== undefined
        ? scalarNumber(lineHeightResolution.value.resolvedValue) as number
        : undefined;

    const weightToken = weights.find(
      (candidate) => lastPathSegment(candidate.path) === name,
    );
    const weightResolution = weightToken === undefined ? undefined : resolveTokenModeValue(weightToken, "light");
    const weight = weightResolution !== undefined
      && weightResolution.kind === "ok"
      && scalarNumber(weightResolution.value.resolvedValue) !== undefined
        ? scalarNumber(weightResolution.value.resolvedValue) as number
        : undefined;

    // 현행 compressor 관례와 동일한 기본값(4/8 base unit 규칙과 무관한 fallback)
    scale.push({ name, size, weight: weight ?? 400, lineHeight: lineHeight ?? 1.5 });
  }

  for (const token of lineHeights) {
    if (!fontSizeNames.has(lastPathSegment(token.path))) {
      loss.lossy.push({
        tokenId: token.id,
        path: token.path,
        code: "unmatched-typography",
        reason: "대응하는 font-size 스텝 없음 — draft에 미반영",
      });
    }
  }
  for (const token of weights) {
    if (!fontSizeNames.has(lastPathSegment(token.path))) {
      loss.lossy.push({
        tokenId: token.id,
        path: token.path,
        code: "unmatched-typography",
        reason: "대응하는 font-size 스텝 없음 — draft에 미반영",
      });
    }
  }

  const modes: AstryxThemeInput["modes"] = {};
  if (lightColors.length > 0 || lightSpacing.length > 0) {
    modes.light = {};
    if (lightColors.length > 0) modes.light.colors = lightColors;
    if (lightSpacing.length > 0) {
      modes.light.spacing = {
        baseUnit: Math.min(...lightSpacing),
        scale: [...new Set(lightSpacing)].sort((a, b) => a - b),
      };
    }
  }
  if (darkColors.length > 0 || darkSpacing.length > 0) {
    modes.dark = {};
    if (darkColors.length > 0) modes.dark.colors = darkColors;
    if (darkSpacing.length > 0) {
      modes.dark.spacing = {
        baseUnit: Math.min(...darkSpacing),
        scale: [...new Set(darkSpacing)].sort((a, b) => a - b),
      };
    }
  }

  const input: AstryxThemeInput = {
    baseTheme: params.baseTheme ?? "neutral",
    modes,
  };

  if (scale.length > 0) {
    const sizes = scale.map((step) => step.size).sort((a, b) => a - b);
    // 타이포그래피는 mode 무관 — 기존 변환기의 light 우선 규칙에 따라 기록한다.
    const target = modes.light ?? modes.dark ?? {};
    if (modes.light === undefined && modes.dark === undefined) modes.light = target;
    target.typography = {
      families: [...new Set(families)],
      scale,
      baseSize: sizes[Math.floor(sizes.length / 2)],
    };
  } else if (families.length > 0) {
    // font-size 스텝이 없으면 typography 매핑을 생략하고 구조화 보고
    loss.lossy.push({
      path: "typography",
      code: "missing-font-scale",
      reason: "font-size 토큰 없음 — 타이포그래피 매핑 생략",
    });
  }

  if (overrideRoles.size > 0) {
    input.roleOverrides = [...overrideRoles.entries()].map(([id, role]) => ({
      token: pathById.get(id) ?? id,
      role,
    }));
  }

  const draft = convertPenpotTokensToAstryx(input);

  // 6.3: mode 누락 경고는 loss.ambiguous(missing-light/missing-dark)로 대체
  draft.warnings = draft.warnings.filter(
    (warning) => warning.code !== "MISSING_DARK_MODE" && warning.code !== "MISSING_LIGHT_MODE",
  );

  // 6.3: 충돌(M3) → mapping conflict + loss.ambiguous 병기
  for (const mapping of draft.mapping) {
    if (mapping.status === "conflict") {
      loss.ambiguous.push({
        tokenId: idByPath.get(mapping.sourceToken),
        path: mapping.sourceToken,
        mode: mapping.mode,
        code: "conflict",
        reason: mapping.rationale,
      });
    }
  }

  return { value: draft, loss: sortImportLoss(loss) };
}

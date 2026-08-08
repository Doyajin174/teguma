/**
 * Penpot compressed token → canonical token document 어댑터 (명세 5.1).
 *
 * - colors: path/name 분리 보존, role은 `confidence: "mapped"`로 보존(추론임 명시).
 *   불투명도(@NN%)는 alpha로 변환 + lossy 보고, gradient는 unsupported 보고.
 * - typography: scale 항목을 속성별 토큰으로 분해(5.1) — fontSize/fontWeight/
 *   lineHeight/letterSpacing. textTransform은 lossy(dropped-property).
 * - spacing: shape 추론 baseUnit·scale은 kind "spacing" 토큰 + lossy("추론") 보고.
 * - mode: default만 (Penpot에 light/dark 없음). alias 없음(flat 구조).
 */

import { compressBrandContext, inferColorRole } from "../../compressor.js";
import { hexToRgb } from "../../design/color.js";
import type { PenpotFile } from "../../penpot/types.js";
import { compareBytes, sortImportLoss } from "../canonical.js";
import {
  CANONICAL_SCHEMA_VERSION,
  type CanonicalLossItem,
  type CanonicalModeValue,
  type CanonicalScalar,
  type CanonicalToken,
  type CanonicalTokenDocument,
  type CanonicalValue,
  type ColorStruct,
  type JsonValue,
} from "../schema.js";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LENGTH_RE = /^(-?\d+(?:\.\d+)?)(px|rem)$/;
const UNITLESS_RE = /^-?\d+(?:\.\d+)?$/;

function identityValue(value: CanonicalScalar["value"], unit?: CanonicalScalar["unit"]): CanonicalValue {
  const scalar: CanonicalScalar = unit === undefined ? { value } : { value, unit };
  return { sourceValue: scalar, resolvedValue: scalar };
}

function colorStruct(hex: string, alpha: number): ColorStruct {
  const [r, g, b] = hexToRgb(hex);
  return { colorSpace: "srgb", components: [r, g, b], alpha, hex };
}

function combinedPath(name: string, path?: string): string {
  return path ? `${path}/${name}` : name;
}

function resolvedModeValue(raw: JsonValue, value: CanonicalValue): CanonicalModeValue {
  return { status: "resolved", raw, resolvedValue: value };
}

/** Penpot 파일 → canonical token document (명세 5.1). */
export function transformPenpotFileToCanonical(file: PenpotFile): CanonicalTokenDocument {
  const compressed = compressBrandContext(file);
  const { colors, typography, spacing } = compressed.tokens;

  const tokens: CanonicalToken[] = [];
  const unsupported: CanonicalLossItem[] = [];
  const lossy: CanonicalLossItem[] = [];

  // ── colors (5.1) ────────────────────────────────────────────────────────────
  for (const color of file.colors) {
    const path = combinedPath(color.name, color.path);
    const role = inferColorRole(color.name, color.path);
    const hex = color.color;

    if (color.gradient !== undefined) {
      unsupported.push({
        path,
        mode: "default",
        code: "unsupported-category",
        reason: "gradient 구조는 v0.2에서 보존",
        raw: color.gradient as unknown as JsonValue,
      });
    }
    if (!HEX_COLOR_RE.test(hex)) {
      if (color.gradient === undefined) {
        unsupported.push({
          path,
          mode: "default",
          code: "unsupported-color",
          reason: "hex #RRGGBB 값이 아님 — v0.1 미지원",
          raw: hex,
        });
      }
      continue;
    }

    const normalized = hex.toLowerCase();
    const hasOpacity = color.opacity !== undefined && color.opacity < 1;
    const alpha = hasOpacity ? color.opacity as number : 1;
    const value = identityValue(colorStruct(normalized, alpha));

    tokens.push({
      id: `penpot:${file.id}:${color.id}`,
      name: color.name,
      path,
      type: "color",
      values: { default: resolvedModeValue(hex, value) },
      ...(role !== undefined
        ? { semanticRole: { role, confidence: "mapped" as const } }
        : {}),
      provenance: { adapter: "penpot", sourcePath: path, sourceId: color.id },
    });

    if (hasOpacity) {
      const percent = Math.round((color.opacity as number) * 100);
      lossy.push({
        tokenId: `penpot:${file.id}:${color.id}`,
        path,
        mode: "default",
        code: "opacity-to-alpha",
        reason: `불투명도 접미사(@${percent}%)를 alpha로 변환 — 원문은 original에 보존`,
        original: `${hex} @${percent}%`,
        converted: { value: colorStruct(normalized, alpha) },
      });
    }
  }

  // ── typography: scale 항목을 속성별 토큰으로 분해 (5.1) ─────────────────────
  for (const entry of file.typographies) {
    const path = combinedPath(entry.name, entry.path);
    const idSuffix = `:${entry.id}`;
    const makeToken = (
      property: string,
      type: CanonicalToken["type"],
      kind: CanonicalToken["kind"],
      raw: JsonValue,
      value: CanonicalValue,
    ): CanonicalToken => ({
      id: `penpot:${file.id}${idSuffix}:${property}`,
      name: entry.name,
      path,
      type,
      ...(kind !== undefined ? { kind } : {}),
      values: { default: resolvedModeValue(raw, value) },
      provenance: { adapter: "penpot", sourcePath: path, sourceId: entry.id },
    });

    const fontSize = Number.parseFloat(entry.fontSize);
    if (Number.isFinite(fontSize) && fontSize > 0) {
      tokens.push(makeToken("font-size", "dimension", "font-size", entry.fontSize, identityValue(fontSize, "px")));
    } else {
      lossy.push({
        path,
        mode: "default",
        code: "unparseable-value",
        reason: "fontSize를 숫자로 해석할 수 없음",
        original: entry.fontSize,
      });
    }

    const weight = Number.parseInt(entry.fontWeight, 10);
    if (Number.isInteger(weight) && weight >= 1 && weight <= 1000) {
      tokens.push(makeToken("font-weight", "fontWeight", undefined, entry.fontWeight, identityValue(weight)));
    } else if (typeof entry.fontWeight === "string" && entry.fontWeight.trim() !== "") {
      // DTCG 규정 문자열 alias는 원문 보존(4.5)
      tokens.push(makeToken("font-weight", "fontWeight", undefined, entry.fontWeight, identityValue(entry.fontWeight.trim())));
    } else {
      lossy.push({
        path,
        mode: "default",
        code: "unparseable-value",
        reason: "fontWeight를 해석할 수 없음",
        original: entry.fontWeight,
      });
    }

    const lineHeightText = entry.lineHeight.trim();
    const lineHeightLength = LENGTH_RE.exec(lineHeightText);
    if (lineHeightLength !== null) {
      const value = Number.parseFloat(lineHeightLength[1]);
      if (lineHeightLength[2] === "rem") {
        tokens.push(makeToken("line-height", "dimension", "line-height", entry.lineHeight, {
          sourceValue: { value, unit: "rem" },
          resolvedValue: { value, unit: "rem" },
        }));
      } else {
        tokens.push(makeToken("line-height", "dimension", "line-height", entry.lineHeight, identityValue(value, "px")));
      }
    } else if (UNITLESS_RE.test(lineHeightText)) {
      const value = Number.parseFloat(lineHeightText);
      if (Number.isFinite(value) && value > 0) {
        tokens.push(makeToken("line-height", "number", "line-height", entry.lineHeight, identityValue(value)));
      } else {
        lossy.push({
          path,
          mode: "default",
          code: "unparseable-value",
          reason: "lineHeight가 양수가 아님",
          original: entry.lineHeight,
        });
      }
    } else {
      lossy.push({
        path,
        mode: "default",
        code: "unparseable-value",
        reason: "lineHeight를 px/rem/비율로 해석할 수 없음",
        original: entry.lineHeight,
      });
    }

    if (entry.letterSpacing !== undefined) {
      const letterSpacingText = entry.letterSpacing.trim();
      const spacingMatch = LENGTH_RE.exec(letterSpacingText);
      if (spacingMatch !== null) {
        const value = Number.parseFloat(spacingMatch[1]);
        tokens.push(makeToken(
          "letter-spacing",
          "dimension",
          "letter-spacing",
          entry.letterSpacing,
          identityValue(value, spacingMatch[2] === "rem" ? "rem" : "px"),
        ));
      } else {
        lossy.push({
          path,
          mode: "default",
          code: "unparseable-value",
          reason: "letterSpacing을 px/rem으로 해석할 수 없음",
          original: entry.letterSpacing,
        });
      }
    }

    if (entry.textTransform !== undefined) {
      lossy.push({
        tokenId: `penpot:${file.id}${idSuffix}:font-size`,
        path,
        mode: "default",
        code: "dropped-property",
        reason: "textTransform은 v0.1에서 표현 불가",
        original: entry.textTransform,
      });
    }
  }

  // ── spacing: shape 추론 baseUnit·scale (5.1) ───────────────────────────────
  const spacingOriginal: JsonValue = { baseUnit: spacing.baseUnit, scale: spacing.scale };
  const pushSpacingToken = (idSuffix: string, name: string, path: string, value: number): void => {
    const tokenId = `penpot:${file.id}:spacing:${idSuffix}`;
    tokens.push({
      id: tokenId,
      name,
      path,
      type: "dimension",
      kind: "spacing",
      values: { default: resolvedModeValue(value, identityValue(value, "px")) },
      provenance: { adapter: "penpot", sourcePath: path, sourceId: idSuffix },
    });
    lossy.push({
      tokenId,
      path,
      mode: "default",
      code: "inferred-spacing",
      reason: "shape에서 추론한 baseUnit·scale — 원본 토큰 아님",
      original: spacingOriginal,
    });
  };
  pushSpacingToken("base", "base", "Spacing/base", spacing.baseUnit);
  for (const step of spacing.scale) {
    pushSpacingToken(String(step), `${step}px`, `Spacing/${step}px`, step);
  }

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    document: {
      id: `canonical:penpot:${file.id}`,
      sourceAdapter: "penpot",
      sourceName: file.name,
    },
    tokens: [...tokens].sort((a, b) => compareBytes(a.id, b.id)),
    importLoss: sortImportLoss({ unsupported, ambiguous: [], lossy }),
  };
}

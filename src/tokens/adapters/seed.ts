/**
 * SEED rootage → canonical token document 어댑터 (명세 5.2).
 *
 * - category → type/kind 매핑(5.2), light/dark 병합(logical token, 4.2).
 * - "$" 참조는 logical id alias로 보존 — 순환/미존재는 unresolved로 보고(4.3).
 * - rem→px 환산은 sourceValue/resolvedValue/conversion으로 보존(4.4) —
 *   기존 transformSeedRootage의 mode·참조·단위 결과와 회귀 없이 일치한다.
 * - 범주·구조·단위 실패는 importLoss(unsupported/lossy)로 구조화 보고(4.6).
 * - 기본(mode 미지정)은 파일의 전 mode를 lossless로 읽는다. mode 지정 시 해당
 *   mode 값만 포함한다(color는 theme-light/theme-dark, global은 default).
 *
 * 판정 노트:
 * - SEED `dimension` 범주는 명세 10.1 예시(global-gutter: kind "spacing")와
 *   4.5(kind 구분)에 따라, resolved 값이 있는 토큰은 kind "spacing"으로 분류한다.
 *   값이 전부 unresolved인 토큰(예: breakpoint.md)은 kind를 생략한다.
 * - 비표준 단위(em·vw 등)는 폐쇄 unit enum(4.4)에 없으므로 스칼라 value에 원문
 *   문자열로 보존하고 importLoss.lossy(nonstandard-unit)로 보고한다.
 */

import {
  DEFAULT_ROOT_FONT_SIZE_PX,
  type SeedCategory,
  type SeedMode,
  type SeedRootageFile,
  type SeedTokenDef,
  type YamlScalar,
  type YamlValue,
} from "../../design/seed.js";
import { hexToRgb } from "../../design/color.js";
import { sortImportLoss, sortTokens } from "../canonical.js";
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
  type ModeValues,
} from "../schema.js";

export interface CanonicalSeedOptions {
  /**
   * mode 필터. 기본(미지정)은 전 mode를 lossless로 포함.
   * "theme-light"/"theme-dark" 지정 시 color 토큰을 해당 mode로 제한한다
   * (global 컬렉션은 항상 default — 5.2).
   */
  mode?: SeedMode;
  /** rem→px 환산 기준. 기본 16px (기존 변환기와 동일). */
  rootFontSizePx?: number;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LENGTH_RE = /^(-?\d+(?:\.\d+)?)(px|rem)$/;
const UNIT_SUFFIX_RE = /^(-?\d+(?:\.\d+)?)([a-z%]+)$/i;
const UNITLESS_RE = /^-?\d+(?:\.\d+)?$/;
const DURATION_RE = /^(-?\d+(?:\.\d+)?)(ms|s)$/;

/**
 * canonical 어댑터의 category 판별 — 명세 5.2 매핑 표 기준.
 * 기존 seed.ts의 POC 범위(radius/duration 미지원)와 달리 radius/duration도
 * 지원한다(기존 transformSeedRootage 동작은 변경하지 않음).
 */
type CanonicalSeedCategory = SeedCategory | "radius" | "duration";

const CANONICAL_CATEGORY_BY_NAMESPACE: Record<string, CanonicalSeedCategory> = {
  color: "color",
  "font-family": "font-family",
  "font-weight": "font-weight",
  "font-size": "font-size",
  "line-height": "line-height",
  "letter-spacing": "letter-spacing",
  dimension: "dimension",
  radius: "radius",
  duration: "duration",
};

function canonicalCategoryForPath(path: string): CanonicalSeedCategory | undefined {
  return CANONICAL_CATEGORY_BY_NAMESPACE[path.slice(1).split(".", 1)[0]];
}

function isScalar(value: YamlValue | undefined): value is YamlScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function lastPathSegment(path: string): string {
  return path.split(".").at(-1) ?? path;
}

function asJson(value: YamlValue): JsonValue {
  return value as unknown as JsonValue;
}

function identityValue(value: CanonicalScalar["value"], unit?: CanonicalScalar["unit"]): CanonicalValue {
  const scalar: CanonicalScalar = unit === undefined ? { value } : { value, unit };
  return { sourceValue: scalar, resolvedValue: scalar };
}

function colorStruct(hex: string): ColorStruct {
  const [r, g, b] = hexToRgb(hex);
  return { colorSpace: "srgb", components: [r, g, b], alpha: 1, hex };
}

// ─────────────────────────────────────────────────────────────────────────────
// 스칼라 정규화 (4.4·4.5)
// ─────────────────────────────────────────────────────────────────────────────

type ScalarResult =
  | { status: "ok"; value: CanonicalValue }
  | { status: "lossy"; reason: string; original: JsonValue; scalar: CanonicalScalar }
  | { status: "unsupported"; reason: string };

function normalizeColor(raw: YamlScalar, path: string): CanonicalValue {
  if (typeof raw !== "string" || !HEX_COLOR_RE.test(raw)) {
    throw new Error(`invalid color value ${JSON.stringify(raw)} for ${path}: expected #RRGGBB`);
  }
  const hex = raw.toLowerCase();
  return identityValue(colorStruct(hex));
}

function normalizeFontFamily(raw: YamlScalar, path: string): CanonicalValue {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`invalid font family value ${JSON.stringify(raw)} for ${path}`);
  }
  return identityValue(raw.trim());
}

/** fontWeight: 1..1000 정수로 정규화, DTCG 규정 문자열 alias는 원문 보존(4.5). */
function normalizeFontWeight(raw: YamlScalar, path: string): CanonicalValue {
  const numeric = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : Number.NaN;
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 1000) {
    return identityValue(numeric);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return identityValue(raw.trim());
  }
  throw new Error(`invalid font weight ${JSON.stringify(raw)} for ${path}: expected 1..1000 integer or alias`);
}

function normalizeLength(
  raw: YamlScalar,
  path: string,
  rootFontSizePx: number,
  allowNegative: boolean,
): ScalarResult {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || (!allowNegative && raw < 0)) {
      throw new Error(`invalid length ${raw} for ${path}: must be finite ${allowNegative ? "" : "non-negative "}`);
    }
    return { status: "ok", value: identityValue(raw, "px") };
  }
  if (typeof raw !== "string") {
    throw new Error(`invalid length value ${JSON.stringify(raw)} for ${path}`);
  }
  const text = raw.trim();
  const match = LENGTH_RE.exec(text);
  if (match !== null) {
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || (!allowNegative && value < 0)) {
      throw new Error(`invalid length ${JSON.stringify(raw)} for ${path}`);
    }
    if (match[2] === "rem") {
      const resolved: CanonicalValue = {
        sourceValue: { value, unit: "rem" },
        resolvedValue: { value: value * rootFontSizePx, unit: "px" },
        conversion: { kind: "rem-to-px", rootFontSizePx },
      };
      return { status: "ok", value: resolved };
    }
    return { status: "ok", value: identityValue(value, "px") };
  }
  const unitMatch = UNIT_SUFFIX_RE.exec(text);
  if (unitMatch !== null) {
    // 비표준 단위 — 원문 문자열을 스칼라 value로 보존(4.4), lossy 보고.
    const scalar: CanonicalScalar = { value: text };
    return {
      status: "lossy",
      reason: `unsupported unit "${unitMatch[2]}"; only px and rem are supported`,
      original: text,
      scalar,
    };
  }
  if (UNITLESS_RE.test(text)) {
    return { status: "unsupported", reason: "unit-less length; only px and rem are supported" };
  }
  throw new Error(`invalid length value ${JSON.stringify(raw)} for ${path}: expected a px/rem length`);
}

/**
 * line-height: 비율(number) 또는 단위 값(dimension) — 4.5.
 * "150%"는 percent-to-ratio 변환(4.4), 단위 없는 문자열은 비율로 해석한다.
 */
function normalizeLineHeight(
  raw: YamlScalar,
  path: string,
  rootFontSizePx: number,
): ScalarResult {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error(`invalid line height ${raw} for ${path}`);
    }
    return { status: "ok", value: identityValue(raw) };
  }
  if (typeof raw !== "string") {
    throw new Error(`invalid line height value ${JSON.stringify(raw)} for ${path}`);
  }
  const text = raw.trim();
  const percent = /^(-?\d+(?:\.\d+)?)%$/.exec(text);
  if (percent !== null) {
    const value = Number.parseFloat(percent[1]);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid line height ${JSON.stringify(raw)} for ${path}`);
    }
    const resolved: CanonicalValue = {
      sourceValue: { value, unit: "%" },
      resolvedValue: { value: value / 100 },
      conversion: { kind: "percent-to-ratio" },
    };
    return { status: "ok", value: resolved };
  }
  if (UNITLESS_RE.test(text)) {
    const value = Number.parseFloat(text);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`invalid line height ${JSON.stringify(raw)} for ${path}`);
    }
    return { status: "ok", value: identityValue(value) };
  }
  return normalizeLength(raw, path, rootFontSizePx, false);
}

function normalizeDuration(raw: YamlScalar, path: string): ScalarResult {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      throw new Error(`invalid duration ${raw} for ${path}`);
    }
    return { status: "ok", value: identityValue(raw, "ms") };
  }
  if (typeof raw !== "string") {
    throw new Error(`invalid duration value ${JSON.stringify(raw)} for ${path}`);
  }
  const text = raw.trim();
  const match = DURATION_RE.exec(text);
  if (match !== null) {
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`invalid duration ${JSON.stringify(raw)} for ${path}`);
    }
    return { status: "ok", value: identityValue(value, match[2] as "ms" | "s") };
  }
  const unitMatch = UNIT_SUFFIX_RE.exec(text);
  if (unitMatch !== null) {
    const scalar: CanonicalScalar = { value: text };
    return {
      status: "lossy",
      reason: `unsupported duration unit "${unitMatch[2]}"; only ms and s are supported`,
      original: text,
      scalar,
    };
  }
  throw new Error(`invalid duration value ${JSON.stringify(raw)} for ${path}: expected Nms or Ns`);
}

// ─────────────────────────────────────────────────────────────────────────────
// "$" 참조 해석 (4.2·4.3)
// ─────────────────────────────────────────────────────────────────────────────

type AliasResolution =
  | { status: "ok"; raw: YamlScalar }
  | { status: "unresolved"; reason: "circular" | "missing" };

/**
 * 4.2 해석 규칙에 따른 비-예외 참조 해석: 같은 mode → 대상 default → 미존재.
 * 순환 감지는 기존 resolveScalar(seed.ts)와 같은 stack 방식(5.2 "재사용").
 */
function resolveAlias(
  byPath: Map<string, SeedTokenDef>,
  path: string,
  mode: SeedMode,
  stack: string[],
): AliasResolution {
  if (stack.includes(path)) return { status: "unresolved", reason: "circular" };
  const def = byPath.get(path);
  if (def === undefined) return { status: "unresolved", reason: "missing" };
  if (canonicalCategoryForPath(path) === undefined) return { status: "unresolved", reason: "missing" };
  const direct = def.values[mode] ?? def.values["default"];
  if (direct === undefined) return { status: "unresolved", reason: "missing" };
  if (typeof direct === "string" && direct.startsWith("$")) {
    return resolveAlias(byPath, direct, mode, [...stack, path]);
  }
  if (!isScalar(direct)) return { status: "unresolved", reason: "missing" };
  return { status: "ok", raw: direct };
}

// ─────────────────────────────────────────────────────────────────────────────
// 토큰·loss 항목 구성
// ─────────────────────────────────────────────────────────────────────────────

type BuiltModeValue =
  | { kind: "value"; value: CanonicalModeValue; loss?: CanonicalLossItem }
  | { kind: "unsupported"; item: CanonicalLossItem };

function buildModeValue(
  def: SeedTokenDef,
  direct: YamlValue,
  sourceMode: SeedMode,
  category: CanonicalSeedCategory,
  byPath: Map<string, SeedTokenDef>,
  rootFontSizePx: number,
): BuiltModeValue {
  const canonicalMode = sourceMode === "theme-light" ? "light" : sourceMode === "theme-dark" ? "dark" : "default";
  const rawValues: JsonValue = { values: asJson(def.values) };

  if (typeof direct === "string" && direct.startsWith("$")) {
    const ref = `seed:${direct}`;
    const resolved = resolveAlias(byPath, direct, sourceMode, []);
    if (resolved.status === "unresolved") {
      return {
        kind: "value",
        value: {
          status: "unresolved",
          raw: direct,
          alias: { ref, resolved: false, reason: resolved.reason },
        },
      };
    }
    const scalar = buildScalar(resolved.raw, category, def.path, rootFontSizePx);
    if (scalar.status === "lossy") {
      return {
        kind: "value",
        value: {
          status: "resolved",
          raw: direct,
          resolvedValue: { sourceValue: scalar.scalar, resolvedValue: scalar.scalar },
          alias: { ref, resolved: true },
        },
        loss: unsupportedItem(def, canonicalMode, scalar, rawValues),
      };
    }
    if (scalar.status === "unsupported") {
      return { kind: "unsupported", item: unsupportedItem(def, canonicalMode, scalar, rawValues) };
    }
    return {
      kind: "value",
      value: {
        status: "resolved",
        raw: direct,
        resolvedValue: scalar.value,
        alias: { ref, resolved: true },
      },
    };
  }

  if (isScalar(direct)) {
    const scalar = buildScalar(direct, category, def.path, rootFontSizePx);
    if (scalar.status === "lossy") {
      // 비표준 단위 — 토큰은 보존(4.4 "sourceValue에 보존") + lossy 보고.
      return {
        kind: "value",
        value: {
          status: "resolved",
          raw: direct,
          resolvedValue: { sourceValue: scalar.scalar, resolvedValue: scalar.scalar },
        },
        loss: unsupportedItem(def, canonicalMode, scalar, rawValues),
      };
    }
    if (scalar.status === "unsupported") {
      return { kind: "unsupported", item: unsupportedItem(def, canonicalMode, scalar, rawValues) };
    }
    return { kind: "value", value: { status: "resolved", raw: direct, resolvedValue: scalar.value } };
  }

  // 구조화 직접 값 — v0.1은 스칼라 토큰만 지원 (10.1 gradient 예시와 동일한 코드).
  return {
    kind: "unsupported",
    item: {
      path: def.path,
      mode: canonicalMode,
      code: "unsupported-category",
      reason: "구조화 값 — v0.1은 스칼라 토큰만 지원",
      raw: rawValues,
    },
  };
}

function unsupportedItem(
  def: SeedTokenDef,
  mode: "default" | "light" | "dark",
  scalar: ScalarResult,
  rawValues: JsonValue,
): CanonicalLossItem {
  if (scalar.status === "lossy") {
    return {
      tokenId: `seed:${def.path}`,
      path: def.path,
      mode,
      code: "nonstandard-unit",
      reason: scalar.reason,
      original: scalar.original,
      converted: scalar.scalar,
    };
  }
  if (scalar.status === "unsupported") {
    return {
      path: def.path,
      mode,
      code: "unitless-length",
      reason: scalar.reason,
      raw: rawValues,
    };
  }
  throw new Error("unreachable: scalar.status ok passed to unsupportedItem");
}

function buildScalar(
  raw: YamlScalar,
  category: CanonicalSeedCategory,
  path: string,
  rootFontSizePx: number,
): ScalarResult {
  switch (category) {
    case "color":
      return { status: "ok", value: normalizeColor(raw, path) };
    case "font-family":
      return { status: "ok", value: normalizeFontFamily(raw, path) };
    case "font-weight":
      return { status: "ok", value: normalizeFontWeight(raw, path) };
    case "font-size":
      return normalizeLength(raw, path, rootFontSizePx, false);
    case "line-height":
      return normalizeLineHeight(raw, path, rootFontSizePx);
    case "letter-spacing":
      return normalizeLength(raw, path, rootFontSizePx, true);
    case "dimension":
    case "radius":
      return normalizeLength(raw, path, rootFontSizePx, false);
    case "duration":
      return normalizeDuration(raw, path);
    default:
      throw new Error(`unhandled seed category ${category}`);
  }
}

function typeFor(category: CanonicalSeedCategory, hasUnit: boolean): CanonicalToken["type"] {
  switch (category) {
    case "color": return "color";
    case "font-family": return "fontFamily";
    case "font-weight": return "fontWeight";
    case "font-size": return "dimension";
    case "line-height": return hasUnit ? "dimension" : "number";
    case "letter-spacing": return "dimension";
    case "dimension": return "dimension";
    case "radius": return "dimension";
    case "duration": return "duration";
    default: throw new Error(`unhandled seed category ${category}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 어댑터
// ─────────────────────────────────────────────────────────────────────────────

/** SEED rootage → canonical token document (명세 5.2). */
export function transformSeedRootageToCanonical(
  rootage: SeedRootageFile,
  options: CanonicalSeedOptions = {},
): CanonicalTokenDocument {
  const mode = options.mode;
  if (mode !== undefined && !["theme-light", "theme-dark", "default"].includes(mode)) {
    throw new Error(`mode is required and must be one of: theme-light, theme-dark, default`);
  }
  const rootFontSizePx = options.rootFontSizePx ?? DEFAULT_ROOT_FONT_SIZE_PX;
  if (!Number.isFinite(rootFontSizePx) || rootFontSizePx <= 0) {
    throw new Error(`rootFontSizePx must be a positive finite number, got ${rootFontSizePx}`);
  }

  const byPath = new Map(rootage.tokens.map((def) => [def.path, def]));
  const tokens: CanonicalToken[] = [];
  const unsupported: CanonicalLossItem[] = [];
  const lossy: CanonicalLossItem[] = [];

  for (const def of rootage.tokens) {
    const category = canonicalCategoryForPath(def.path);
    if (category === undefined) {
      unsupported.push({
        path: def.path,
        code: "unsupported-category",
        reason: `token category "${def.path.slice(1).split(".", 1)[0]}" is out of v0.1 scope`,
        raw: { values: asJson(def.values) },
      });
      continue;
    }

    const isColor = category === "color";
    // 5.2 "default→values.default": color도 default 값을 읽는다. 순서는 canonical
    // values 키 순서(default→light→dark)와 같게 default를 먼저 둔다.
    const sourceModes: SeedMode[] = isColor ? ["default", "theme-light", "theme-dark"] : ["default"];
    const canonicalModeOf = (source: SeedMode): "light" | "dark" | "default" =>
      source === "theme-light" ? "light" : source === "theme-dark" ? "dark" : "default";

    const values: ModeValues = {};
    let anyResolved = false;
    let hasUnit = false;
    // 값 또는 per-mode 실패(unsupported/lossy)가 하나라도 보고됐는지 —
    // 아무것도 없을 때만 missing-mode를 보고한다(구조화 값 등은 이미 보고됨).
    let anyReported = false;

    for (const sourceMode of sourceModes) {
      if (isColor && mode !== undefined && sourceMode !== mode) continue;
      const direct = def.values[sourceMode];
      if (direct === undefined) continue;
      const built = buildModeValue(def, direct, sourceMode, category, byPath, rootFontSizePx);
      if (built.kind === "value") {
        values[canonicalModeOf(sourceMode)] = built.value;
        anyReported = true;
        if (built.loss !== undefined) {
          (built.loss.code === "nonstandard-unit" ? lossy : unsupported).push(built.loss);
        }
        if (built.value.status === "resolved") {
          anyResolved = true;
          if (built.value.resolvedValue.resolvedValue.unit !== undefined) hasUnit = true;
        }
      } else {
        anyReported = true;
        (built.item.code === "nonstandard-unit" ? lossy : unsupported).push(built.item);
      }
    }

    if (Object.keys(values).length === 0) {
      // mode 필터 결과 값이 없는 color 토큰 — 기존 unsupported 보고와 동일(5.2).
      // mode 미지정이면 값 자체가 없는 경우 — 원칙 4(조용히 버리지 않음)에 따라 보고.
      if (isColor && !anyReported) {
        unsupported.push({
          path: def.path,
          ...(mode !== undefined ? { mode: canonicalModeOf(mode) } : {}),
          code: "missing-mode",
          reason: mode !== undefined
            ? `color tokens have no "${mode}" mode in SEED rootage; pass theme-light or theme-dark`
            : "color 토큰에 theme-light/theme-dark/default 값이 모두 없음 — 탈락 (원칙 4)",
          raw: { values: asJson(def.values) },
        });
      }
      continue;
    }

    const kind = category === "font-size"
      ? "font-size" as const
      : category === "line-height"
        ? "line-height" as const
        : category === "letter-spacing"
          ? "letter-spacing" as const
          : category === "radius"
            ? "radius" as const
            : category === "dimension" && anyResolved
              ? "spacing" as const
              : undefined;

    tokens.push({
      id: `seed:${def.path}`,
      name: lastPathSegment(def.path),
      path: def.path,
      type: typeFor(category, hasUnit),
      ...(kind !== undefined ? { kind } : {}),
      values,
      provenance: {
        adapter: "seed",
        sourcePath: def.path,
        sourceId: rootage.metadata.id,
        collection: def.collection,
      },
      ...(def.description !== undefined ? { description: def.description } : {}),
    });
  }

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    document: {
      id: `canonical:seed:${rootage.metadata.id}`,
      sourceAdapter: "seed",
      sourceName: rootage.metadata.name,
    },
    tokens: sortTokens(tokens),
    importLoss: sortImportLoss({ unsupported, ambiguous: [], lossy }),
  };
}

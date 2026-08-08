/**
 * SEED rootage YAML → teguma BrandKit/DesignDocument 변환기 (POC).
 *
 * 이슈 #22 — 당근 SEED 연동 POC. daangn/seed-design `packages/rootage`의 YAML
 * (`kind: Tokens` / `metadata` / `data.collection` / `data.tokens`, mode별
 * `values`, "$" 완전 경로 참조)을 결정론적으로 해석해 teguma `BrandKit`과
 * typography/spacing 문서 생성 입력, 대표 `DesignDocument`를 만든다.
 *
 * 컬렉션별 mode 규칙(collections.yaml 원본 기준)
 * - color 컬렉션: `theme-light` / `theme-dark`. 호출자가 고른 mode가 색상에 적용되고,
 *   `default` 호출 시 색상 토큰은 manifest.unsupported로 보고한다(실제 rootage
 *   색상에는 default mode가 없다).
 * - global 컬렉션(font-size, line-height, letter-spacing, dimension,
 *   font-family, font-weight): 유일한 mode인 `default`로 항상 해석한다.
 *
 * 지원 범주: color, font-family, font-weight, font-size, line-height,
 * letter-spacing, dimension. 그 외(radius/shadow/gradient/duration/scale/
 * component schema 등)는 조용히 버리지 않고 manifest.unsupported에 남긴다.
 * 지원 단위는 px와 rem(입력 root font-size 기준 환산)뿐이며, 그 외 단위
 * (em·pt 등)와 단위 없는 길이 값은 변환을 중단하지 않고 manifest.unsupported로
 * 보고한다.
 *
 * 의존성 정책: 새 의존성을 추가하지 않는다. YAML은 아래의 최소 블록 스타일
 * 서브셋 파서(주석·따옴표·블록 맵·블록 시퀀스·스칼라)로 읽는다. 플로우 컬렉션,
 * 앵커/태그, 시퀀스 내 인라인 맵은 명시적 오류로 거부한다.
 */

import { readFileSync } from "node:fs";
import { applyBrandKit } from "./brand-kit.js";
import type { BrandKit, DesignDocument } from "./document.js";
import { parseDesignDocument } from "./document.js";

// ─────────────────────────────────────────────────────────────────────────────
// YAML 최소 파서 (블록 스타일 서브셋)
// ─────────────────────────────────────────────────────────────────────────────

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlMap | YamlValue[];
export interface YamlMap { [key: string]: YamlValue }

interface YamlLine {
  indent: number;
  content: string;
  number: number;
}

/** 변환 계약 위반(구조·참조·단위·값)을 나타내는 오류. */
export class SeedError extends Error {
  readonly path?: string;

  constructor(message: string, path?: string) {
    super(message);
    this.name = "SeedError";
    this.path = path;
  }
}

function isYamlMap(value: YamlValue | undefined): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isYamlScalar(value: YamlValue | undefined): value is YamlScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** `#` 주석을 잘라낸다. 따옴표 안의 `#`(예: "#ff6600")는 보존한다. */
function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "'" && !inDouble) inSingle = !inSingle;
    else if (character === '"' && !inSingle) inDouble = !inDouble;
    else if (
      character === "#"
      && !inSingle
      && !inDouble
      && (index === 0 || /\s/.test(line[index - 1]))
    ) {
      return line.slice(0, index);
    }
  }
  return line;
}

function preprocess(source: string): YamlLine[] {
  const lines: YamlLine[] = [];
  const rawLines = source.split(/\r?\n/);

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = rawLines[index];
    const lineNumber = index + 1;
    if (/^[ \t]*\t/.test(raw)) {
      throw new SeedError(`line ${lineNumber}: tab indentation is not supported`);
    }
    const content = stripComment(raw.trim()).trimEnd();
    if (content === "") continue;
    lines.push({ indent: raw.length - raw.trimStart().length, content, number: lineNumber });
  }
  return lines;
}

function parseDoubleQuoted(body: string, lineNumber: number): string {
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character !== "\\") {
      out += character;
      continue;
    }
    const next = body[index + 1];
    if (next === undefined) {
      throw new SeedError(`line ${lineNumber}: trailing backslash in double-quoted string`);
    }
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "\\": out += "\\"; break;
      case '"': out += '"'; break;
      case "u": {
        const hex = body.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new SeedError(`line ${lineNumber}: invalid \\u escape in double-quoted string`);
        }
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 4;
        break;
      }
      default: out += next;
    }
    index += 1;
  }
  return out;
}

function parseScalar(raw: string, lineNumber: number): YamlScalar {
  const value = raw.trim();
  if (value === "") return null;
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new SeedError(`line ${lineNumber}: unterminated double-quoted string`);
    }
    return parseDoubleQuoted(value.slice(1, -1), lineNumber);
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new SeedError(`line ${lineNumber}: unterminated single-quoted string`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value === "null" || value === "~" || value === "Null" || value === "NULL") return null;
  if (value === "true" || value === "True" || value === "TRUE") return true;
  if (value === "false" || value === "False" || value === "FALSE") return false;
  if (/^[+-]?\d+$/.test(value)) return Number.parseInt(value, 10);
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return Number.parseFloat(value);
  return value;
}

/** 따옴표 밖의 `key: ` 매핑 콜론 위치를 찾는다. */
function findMappingColon(content: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "'" && !inDouble) inSingle = !inSingle;
    else if (character === '"' && !inSingle) inDouble = !inDouble;
    else if (
      !inSingle
      && !inDouble
      && character === ":"
      && (index + 1 === content.length || /\s/.test(content[index + 1]))
    ) {
      return index;
    }
  }
  return -1;
}

function unquoteKey(key: string, lineNumber: number): string {
  const trimmed = key.trim();
  if (trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return parseScalar(trimmed, lineNumber) as string;
  }
  return trimmed;
}

function splitMappingEntry(line: YamlLine): { key: string; rest: string } {
  const colon = findMappingColon(line.content);
  if (colon === -1) {
    throw new SeedError(`line ${line.number}: expected "key: value"`);
  }
  return {
    key: unquoteKey(line.content.slice(0, colon), line.number),
    rest: line.content.slice(colon + 1).trim(),
  };
}

function parseMapping(lines: YamlLine[], index: number, indent: number): { value: YamlValue; next: number } {
  const map: YamlMap = {};
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SeedError(`line ${line.number}: unexpected indentation (${line.indent} > ${indent})`);
    }
    if (line.content === "-" || line.content.startsWith("- ")) break;

    const { key, rest } = splitMappingEntry(line);
    if (key in map) {
      throw new SeedError(`line ${line.number}: duplicate key "${key}"`);
    }

    if (rest === "") {
      if (cursor + 1 < lines.length && lines[cursor + 1].indent > indent) {
        const nested = parseNode(lines, cursor + 1, lines[cursor + 1].indent);
        map[key] = nested.value;
        cursor = nested.next;
      } else {
        map[key] = null;
        cursor += 1;
      }
      continue;
    }

    if (rest.startsWith("{") || rest.startsWith("[")) {
      throw new SeedError(`line ${line.number}: flow collections are not supported`);
    }
    map[key] = parseScalar(rest, line.number);
    cursor += 1;
  }

  return { value: map, next: cursor };
}

function parseSequence(lines: YamlLine[], index: number, indent: number): { value: YamlValue; next: number } {
  const items: YamlValue[] = [];
  let cursor = index;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new SeedError(`line ${line.number}: unexpected indentation (${line.indent} > ${indent})`);
    }
    if (!(line.content === "-" || line.content.startsWith("- "))) break;

    const rest = line.content.slice(1).trim();
    if (rest === "") {
      if (cursor + 1 < lines.length && lines[cursor + 1].indent > indent) {
        const nested = parseNode(lines, cursor + 1, lines[cursor + 1].indent);
        items.push(nested.value);
        cursor = nested.next;
      } else {
        items.push(null);
        cursor += 1;
      }
      continue;
    }

    if (rest.startsWith("{") || rest.startsWith("[")) {
      throw new SeedError(`line ${line.number}: flow collections are not supported`);
    }
    if (findMappingColon(rest) !== -1) {
      throw new SeedError(`line ${line.number}: inline mappings inside block sequences are not supported`);
    }
    items.push(parseScalar(rest, line.number));
    cursor += 1;
  }

  return { value: items, next: cursor };
}

function parseNode(lines: YamlLine[], index: number, indent: number): { value: YamlValue; next: number } {
  const line = lines[index];
  if (line.indent !== indent) {
    throw new SeedError(`line ${line.number}: unexpected indentation (${line.indent} !== ${indent})`);
  }
  if (line.content === "-" || line.content.startsWith("- ")) {
    return parseSequence(lines, index, indent);
  }
  return parseMapping(lines, index, indent);
}

/** 최소 YAML 서브셋으로 문서를 파싱한다. 최상위는 매핑이어야 한다. */
export function parseSeedYaml(source: string): YamlMap {
  const lines = preprocess(source);
  if (lines.length === 0) throw new SeedError("empty YAML document");
  if (lines[0].indent !== 0) {
    throw new SeedError(`line ${lines[0].number}: top-level content must not be indented`);
  }

  const { value, next } = parseNode(lines, 0, 0);
  if (next < lines.length) {
    throw new SeedError(`line ${lines[next].number}: unexpected content`);
  }
  if (!isYamlMap(value)) {
    throw new SeedError("top-level YAML value must be a mapping");
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// rootage 토큰 모델
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedTokenDef {
  path: string;
  collection: string;
  values: Record<string, YamlValue>;
  /** 토큰 설명(원문 유지, 선택). canonical 어댑터가 보존한다. */
  description?: string;
}

export interface SeedRootageFile {
  kind: "Tokens";
  metadata: { id: string; name: string };
  /** data.collection 원문(파일 단위 선언). */
  collection: string;
  /** 문서 순서를 보존한 토큰 목록. */
  tokens: SeedTokenDef[];
}

/**
 * 실제 rootage 파일별 collection 선언(collections.yaml)에 따른 네임스페이스
 * 판별. 알 수 없는 네임스페이스는 파일의 data.collection으로 되돌린다.
 */
const COLLECTION_BY_NAMESPACE: Record<string, string> = {
  color: "color",
  shadow: "color",
  scale: "motion",
};

export function collectionForPath(path: string, fileCollection: string): string {
  const namespace = path.slice(1).split(".", 1)[0];
  return COLLECTION_BY_NAMESPACE[namespace] ?? fileCollection;
}

/** rootage YAML이 허용된 토큰 구조인지 검증하고 collection·token·values를 얻는다. */
export function parseRootageYaml(source: string): SeedRootageFile {
  const yaml = parseSeedYaml(source);

  if (yaml.kind !== "Tokens") {
    throw new SeedError(`unsupported rootage kind ${JSON.stringify(yaml.kind)} (expected "Tokens")`);
  }
  const metadata = yaml.metadata;
  if (!isYamlMap(metadata) || typeof metadata.id !== "string" || typeof metadata.name !== "string") {
    throw new SeedError("rootage metadata must declare string id and name");
  }
  const data = yaml.data;
  if (!isYamlMap(data) || typeof data.collection !== "string") {
    throw new SeedError("rootage data must declare a string collection");
  }
  const rawTokens = data.tokens;
  if (!isYamlMap(rawTokens)) {
    throw new SeedError("rootage data.tokens must be a mapping");
  }

  const tokens: SeedTokenDef[] = [];
  for (const [path, rawDef] of Object.entries(rawTokens)) {
    if (!path.startsWith("$")) {
      throw new SeedError(`token key must start with "$": ${JSON.stringify(path)}`);
    }
    if (!isYamlMap(rawDef) || !isYamlMap(rawDef.values)) {
      throw new SeedError(`token ${path} must declare a values mapping`);
    }
    tokens.push({
      path,
      collection: collectionForPath(path, data.collection),
      values: rawDef.values,
      ...(typeof rawDef.description === "string" ? { description: rawDef.description } : {}),
    });
  }

  return {
    kind: "Tokens",
    metadata: { id: metadata.id, name: metadata.name },
    collection: data.collection,
    tokens,
  };
}

/** 파일 경로에서 rootage 토큰 구조를 읽는다. */
export function readSeedRootageFile(filePath: string): SeedRootageFile {
  return parseRootageYaml(readFileSync(filePath, "utf8"));
}

// ─────────────────────────────────────────────────────────────────────────────
// mode 선택 · "$" 참조 해석 · 단위/값 정규화
// ─────────────────────────────────────────────────────────────────────────────

export type SeedMode = "theme-light" | "theme-dark" | "default";

export const SEED_MODES: readonly SeedMode[] = ["theme-light", "theme-dark", "default"];

export type SeedCategory =
  | "color"
  | "font-family"
  | "font-weight"
  | "font-size"
  | "line-height"
  | "letter-spacing"
  | "dimension";

const CATEGORY_BY_NAMESPACE: Record<string, SeedCategory> = {
  color: "color",
  "font-family": "font-family",
  "font-weight": "font-weight",
  "font-size": "font-size",
  "line-height": "line-height",
  "letter-spacing": "letter-spacing",
  dimension: "dimension",
};

export function categoryForPath(path: string): SeedCategory | undefined {
  return CATEGORY_BY_NAMESPACE[path.slice(1).split(".", 1)[0]];
}

export interface SeedTransformOptions {
  /** 필수. 색상 컬렉션 mode(theme-light/theme-dark) 또는 global 전용(default). */
  mode: SeedMode;
  /** rem→px 환산 기준. fixture가 명시하지 않으면 16px. */
  rootFontSizePx?: number;
  /** manifest 출처 표기. 기본 "inline". */
  source?: string;
}

export interface SeedTokenEntry {
  path: string;
  collection: string;
  mode: SeedMode;
  /** 해석 전 값("$" 참조 원문 포함). */
  raw: YamlScalar;
  /** 해석·정규화 후 값(hex / px 수치 / 굵기 정수 / family 문자열). */
  value: string | number;
  category: SeedCategory;
  unit?: "px" | "rem";
  /** 단위 변환 기준. */
  conversion?: { from: "rem"; rootFontSizePx: number };
}

export interface SeedUnsupportedEntry {
  path: string;
  collection: string;
  reason: string;
  /** 원문(복합 구조는 JSON 형태). */
  raw: string;
}

export interface SeedManifest {
  source: string;
  mode: SeedMode;
  rootFontSizePx: number;
  tokens: SeedTokenEntry[];
  unsupported: SeedUnsupportedEntry[];
}

export interface SeedTransformResult {
  manifest: SeedManifest;
  /** 색상·font 토큰이 모두 해석된 경우에만 생성된다. */
  brandKit: BrandKit | null;
  /** font-size / line-height / letter-spacing 해석 값(px). */
  typography: SeedTokenEntry[];
  /** dimension 해석 값(px). */
  spacing: SeedTokenEntry[];
  /** 대표 DesignDocument. brandKit이 없으면 null. */
  document: DesignDocument | null;
}

export const DEFAULT_ROOT_FONT_SIZE_PX = 16;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const LENGTH_RE = /^(-?\d+(?:\.\d+)?)(px|rem)$/;
const UNIT_SUFFIX_RE = /^(-?\d+(?:\.\d+)?)([a-z%]+)$/i;
const UNITLESS_RE = /^-?\d+(?:\.\d+)?$/;

type LengthNormalization =
  | { status: "ok"; value: number; unit: "px" | "rem"; conversion?: { from: "rem"; rootFontSizePx: number } }
  | { status: "unsupported"; reason: string };

/**
 * 토큰별 실제 해석 mode. 색상은 호출 mode(테마), global foundation 토큰은
 * 컬렉션의 유일한 mode인 default를 쓴다. 색상에 default를 요청하면 null을
 * 돌려주며 호출부가 unsupported로 보고한다.
 */
function modeForToken(category: SeedCategory, callerMode: SeedMode): SeedMode | null {
  if (category === "color") return callerMode === "default" ? null : callerMode;
  return "default";
}

/** "$" 완전 경로 참조를 순환 없이 재귀 해석한다. */
function resolveScalar(
  byPath: Map<string, SeedTokenDef>,
  path: string,
  mode: SeedMode,
  stack: string[],
): YamlScalar {
  if (stack.includes(path)) {
    throw new SeedError(`circular token reference: ${[...stack, path].join(" -> ")}`, path);
  }
  const def = byPath.get(path);
  if (def === undefined) {
    throw new SeedError(`unknown token reference ${JSON.stringify(path)}`, path);
  }
  if (categoryForPath(path) === undefined) {
    throw new SeedError(`reference ${path} targets an unsupported token category`, path);
  }
  const raw = def.values[mode];
  if (raw === undefined) {
    throw new SeedError(`mode ${JSON.stringify(mode)} is not defined for ${path}`, path);
  }
  if (typeof raw === "string" && raw.startsWith("$")) {
    return resolveScalar(byPath, raw, mode, [...stack, path]);
  }
  if (!isYamlScalar(raw)) {
    throw new SeedError(`token ${path} resolves to a structured value; only scalar tokens are supported`, path);
  }
  return raw;
}

function normalizeColor(raw: YamlScalar, path: string): string {
  if (typeof raw !== "string" || !HEX_COLOR_RE.test(raw)) {
    throw new SeedError(`invalid color value ${JSON.stringify(raw)} for ${path}: expected #RRGGBB`, path);
  }
  return raw.toLowerCase();
}

function normalizeFontFamily(raw: YamlScalar, path: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new SeedError(`invalid font family value ${JSON.stringify(raw)} for ${path}`, path);
  }
  return raw.trim();
}

function normalizeFontWeight(raw: YamlScalar, path: string): number {
  const numeric = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 900) {
    throw new SeedError(`invalid font weight ${JSON.stringify(raw)} for ${path}: expected an integer in 100..900`, path);
  }
  return numeric;
}

function normalizeLength(
  raw: YamlScalar,
  path: string,
  rootFontSizePx: number,
): LengthNormalization {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      throw new SeedError(`invalid length ${raw} for ${path}: must be a finite non-negative number`, path);
    }
    return { status: "ok", value: raw, unit: "px" };
  }
  if (typeof raw !== "string") {
    throw new SeedError(`invalid length value ${JSON.stringify(raw)} for ${path}`, path);
  }

  const length = raw.trim();
  const match = LENGTH_RE.exec(length);
  if (match !== null) {
    const numeric = Number.parseFloat(match[1]);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new SeedError(`invalid length ${JSON.stringify(raw)} for ${path}`, path);
    }
    if (match[2] === "rem") {
      return {
        status: "ok",
        value: numeric * rootFontSizePx,
        unit: "rem",
        conversion: { from: "rem", rootFontSizePx },
      };
    }
    return { status: "ok", value: numeric, unit: "px" };
  }

  const unitMatch = UNIT_SUFFIX_RE.exec(length);
  if (unitMatch !== null) {
    return {
      status: "unsupported",
      reason: `unsupported unit "${unitMatch[2]}"; only px and rem are supported`,
    };
  }
  if (UNITLESS_RE.test(length)) {
    return {
      status: "unsupported",
      reason: "unit-less length; only px and rem are supported",
    };
  }
  throw new SeedError(`invalid length value ${JSON.stringify(raw)} for ${path}: expected a px/rem length`, path);
}

type EntryNormalization =
  | { status: "ok"; entry: SeedTokenEntry }
  | { status: "unsupported"; entry: SeedUnsupportedEntry };

function normalizeEntry(
  base: { path: string; collection: string; mode: SeedMode; raw: YamlScalar; values: Record<string, YamlValue> },
  resolved: YamlScalar,
  category: SeedCategory,
  rootFontSizePx: number,
): EntryNormalization {
  const { path, collection, mode, raw, values } = base;
  switch (category) {
    case "color":
      return { status: "ok", entry: { path, collection, mode, raw, value: normalizeColor(resolved, path), category } };
    case "font-family":
      return { status: "ok", entry: { path, collection, mode, raw, value: normalizeFontFamily(resolved, path), category } };
    case "font-weight":
      return { status: "ok", entry: { path, collection, mode, raw, value: normalizeFontWeight(resolved, path), category } };
    case "font-size":
    case "line-height":
    case "letter-spacing":
    case "dimension": {
      const length = normalizeLength(resolved, path, rootFontSizePx);
      if (length.status === "unsupported") {
        return {
          status: "unsupported",
          entry: { path, collection, reason: length.reason, raw: stringifyRaw(values) },
        };
      }
      return {
        status: "ok",
        entry: {
          path,
          collection,
          mode,
          raw,
          value: length.value,
          category,
          unit: length.unit,
          ...(length.conversion !== undefined ? { conversion: length.conversion } : {}),
        },
      };
    }
  }
}

function stringifyRaw(values: Record<string, YamlValue>): string {
  return JSON.stringify(values);
}

// ─────────────────────────────────────────────────────────────────────────────
// BrandKit / DesignDocument 변환
// ─────────────────────────────────────────────────────────────────────────────

function buildBrandKit(
  entries: SeedTokenEntry[],
  mode: SeedMode,
): BrandKit | null {
  const colors = entries.filter((entry) => entry.category === "color");
  const families = entries.filter((entry) => entry.category === "font-family");
  const weights = entries.filter((entry) => entry.category === "font-weight");
  if (colors.length === 0 || families.length === 0 || weights.length === 0) return null;

  // POC 한계: rootage는 family와 weight를 독립 토큰으로 분리해 두어 family↔weight
  // 연관 관계를 알 수 없다. 따라서 모든 family에 전체 weight 합집합을 등록한다.
  // family별 실제 weight 세트가 필요해지면 별도 매핑 입력/조사로 확장한다.
  return {
    id: `seed-${mode.replace(/^theme-/, "")}`,
    name: `SEED Rootage (${mode})`,
    palette: colors.map((entry) => ({
      id: entry.path.slice(1),
      name: entry.path.slice(1).split(".").at(-1) ?? entry.path.slice(1),
      value: String(entry.value),
    })),
    fonts: [...new Set(families.map((entry) => String(entry.value)))].map((family) => ({
      family,
      weights: [...new Set(weights.map((entry) => Number(entry.value)))].sort((a, b) => a - b),
    })),
    logos: [],
  };
}

function entryValue(entries: SeedTokenEntry[], path: string): string | number | undefined {
  return entries.find((entry) => entry.path === path)?.value;
}

const DOCUMENT_CANVAS_WIDTH = 480;
const DOCUMENT_CANVAS_HEIGHT = 320;

/**
 * 해석된 스케일로 대표 DesignDocument를 만든다. safeMargin·레이어 좌표에
 * `$dimension.spacing-x.global-gutter`를, 텍스트에 t1 타이포그래피와
 * carrot-600/gray 배경을 적용해 QA 통과를 재현한다. 필요한 토큰이 없으면
 * 명시적 오류를 반환한다(조용한 대체 금지).
 */
function buildSeedDocument(
  brandKit: BrandKit,
  mode: SeedMode,
  typography: SeedTokenEntry[],
  spacing: SeedTokenEntry[],
  allEntries: SeedTokenEntry[],
): DesignDocument {
  const required: Array<[string, string | number | undefined]> = [
    ["$dimension.spacing-x.global-gutter", entryValue(spacing, "$dimension.spacing-x.global-gutter")],
    ["$font-size.t1", entryValue(typography, "$font-size.t1")],
    ["$line-height.t1", entryValue(typography, "$line-height.t1")],
    ["$font-family.display", entryValue(allEntries, "$font-family.display")],
    ["$font-weight.regular", entryValue(allEntries, "$font-weight.regular")],
    ["$color.palette.carrot-600", entryValue(allEntries, "$color.palette.carrot-600")],
    [
      mode === "theme-dark" ? "$color.palette.gray-00" : "$color.palette.gray-1000",
      entryValue(allEntries, mode === "theme-dark" ? "$color.palette.gray-00" : "$color.palette.gray-1000"),
    ],
  ];
  const missing = required.filter(([, value]) => value === undefined).map(([path]) => path);
  if (missing.length > 0) {
    throw new SeedError(`representative document requires tokens: ${missing.join(", ")}`);
  }

  const gutter = required[0][1] as number;
  const fontSize = required[1][1] as number;
  const lineHeightPx = required[2][1] as number;
  const family = required[3][1] as string;
  const weight = required[4][1] as number;
  const textColor = required[5][1] as string;
  const background = required[6][1] as string;
  const letterSpacing = entryValue(typography, "$letter-spacing.t1") ?? 0;

  const document = parseDesignDocument({
    id: `seed-poc-${mode.replace(/^theme-/, "")}`,
    title: `SEED POC (${mode})`,
    canvas: {
      width: DOCUMENT_CANVAS_WIDTH,
      height: DOCUMENT_CANVAS_HEIGHT,
      unit: "px",
      safeMargin: gutter,
    },
    brandKit,
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
            lineHeight: lineHeightPx / fontSize,
            letterSpacing,
            opacity: 1,
          },
        ],
      },
    ],
  });

  return applyBrandKit(document, brandKit);
}

/** rootage fixture 하나를 mode·root font-size 기준으로 결정론적으로 변환한다. */
export function transformSeedRootage(
  rootage: SeedRootageFile,
  options: SeedTransformOptions,
): SeedTransformResult {
  if (!SEED_MODES.includes(options.mode)) {
    throw new SeedError(`mode is required and must be one of: ${SEED_MODES.join(", ")}`);
  }
  const mode = options.mode;
  const rootFontSizePx = options.rootFontSizePx ?? DEFAULT_ROOT_FONT_SIZE_PX;
  if (!Number.isFinite(rootFontSizePx) || rootFontSizePx <= 0) {
    throw new SeedError(`rootFontSizePx must be a positive finite number, got ${rootFontSizePx}`);
  }
  const source = options.source ?? "inline";
  const byPath = new Map(rootage.tokens.map((def) => [def.path, def]));

  const tokens: SeedTokenEntry[] = [];
  const unsupported: SeedUnsupportedEntry[] = [];

  for (const def of rootage.tokens) {
    const category = categoryForPath(def.path);
    if (category === undefined) {
      unsupported.push({
        path: def.path,
        collection: def.collection,
        reason: `token category "${def.path.slice(1).split(".", 1)[0]}" is out of POC scope`,
        raw: stringifyRaw(def.values),
      });
      continue;
    }

    const tokenMode = modeForToken(category, mode);
    if (tokenMode === null) {
      unsupported.push({
        path: def.path,
        collection: def.collection,
        reason: `color tokens have no "${mode}" mode in SEED rootage; pass theme-light or theme-dark`,
        raw: stringifyRaw(def.values),
      });
      continue;
    }

    const direct = def.values[tokenMode];
    if (direct === undefined) {
      throw new SeedError(`mode ${JSON.stringify(tokenMode)} is not defined for ${def.path}`, def.path);
    }
    if (!isYamlScalar(direct)) {
      throw new SeedError(`token ${def.path} resolves to a structured value; only scalar tokens are supported`, def.path);
    }
    const raw = resolveScalar(byPath, def.path, tokenMode, []);
    const normalized = normalizeEntry(
      { path: def.path, collection: def.collection, mode: tokenMode, raw: direct, values: def.values },
      raw,
      category,
      rootFontSizePx,
    );
    if (normalized.status === "ok") {
      tokens.push(normalized.entry);
    } else {
      unsupported.push(normalized.entry);
    }
  }

  const typography = tokens.filter(
    (entry) => entry.category === "font-size"
      || entry.category === "line-height"
      || entry.category === "letter-spacing",
  );
  const spacing = tokens.filter((entry) => entry.category === "dimension");
  const brandKit = buildBrandKit(tokens, mode);
  const document = brandKit === null
    ? null
    : buildSeedDocument(brandKit, mode, typography, spacing, tokens);

  return {
    manifest: { source, mode, rootFontSizePx, tokens, unsupported },
    brandKit,
    typography,
    spacing,
    document,
  };
}

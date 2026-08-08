/**
 * tokens.css → canonical 토큰 문서 (명세 9장, #30 계약).
 *
 * - 입력: CSS 커스텀 프로퍼티(--*). 출력: sourceAdapter "open-design" 문서,
 *   결정론 정렬(4.8), mode는 values.default만 (Open Design에 light/dark 없음).
 * - semanticRole: 추측 금지 — 부재(unknown) 또는 사용자 override만.
 * - var() 참조는 alias(ref = 대상 토큰 id)로 해석, 미해결은 unresolved +
 *   importLoss.unsupported(css-var-unresolved).
 * - 비표준 단위(em·vw 등)는 원문 문자열을 스칼라 value로 보존 + lossy
 *   (nonstandard-unit) — #30 4.4·seed 어댑터와 동일 규칙.
 * - canonical 문서에 타임스탬프 없음 (결정론).
 */

import { parseSvgColor } from "./color.js";
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
} from "../../tokens/schema.js";
import { sortCanonicalDocument } from "../../tokens/canonical.js";
import { sourceId12 } from "./bundle.js";

export interface CssTokenExtractOptions {
  sourceId: string;
  contentHash: string;
  sourceName: string;
  /** 사용자 override — 키는 커스텀 프로퍼티 이름("--color-primary"), 값은 role. */
  semanticRoleOverrides?: Record<string, string>;
}

export interface CssTokenExtractResult {
  document: CanonicalTokenDocument;
}

const LENGTH_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem|%)$/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const DURATION_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(ms|s)$/;
const UNIT_SUFFIX_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i;

interface CssDeclaration {
  name: string;
  value: string;
}

/**
 * CSS 문자열 → 커스텀 프로퍼티 목록 (문서 순서, 중복은 마지막 정의 우선).
 * 주석 제거, @media 등 중첩 블록 재귀 수집, var() 값은 그대로 보존.
 */
export function extractCssCustomProperties(css: string): CssDeclaration[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations: CssDeclaration[] = [];
  collectDeclarations(withoutComments, declarations);
  const byName = new Map<string, string>();
  for (const declaration of declarations) {
    byName.set(declaration.name, declaration.value);
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value }));
}

function collectDeclarations(css: string, output: CssDeclaration[]): void {
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf("{", cursor);
    if (open === -1) break;
    const selector = css.slice(cursor, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === "{") depth += 1;
      else if (css[close] === "}") depth -= 1;
      close += 1;
    }
    if (depth !== 0) break;
    const body = css.slice(open + 1, close - 1);
    if (selector.startsWith("@")) {
      // @media 등 — 내부 선언 재귀 수집.
      collectDeclarations(body, output);
    } else {
      for (const raw of body.split(";")) {
        const colon = raw.indexOf(":");
        if (colon === -1) continue;
        const name = raw.slice(0, colon).trim();
        const value = raw.slice(colon + 1).trim();
        if (name.startsWith("--") && value !== "") {
          output.push({ name, value });
        }
      }
    }
    cursor = close;
  }
}

type ResolveResult =
  | { status: "ok"; value: string }
  | { status: "missing"; ref: string }
  | { status: "circular"; ref: string };

/** var(--x, fallback) 해석 — 순환 감지. */
function resolveVar(value: string, props: Map<string, string>, seen: Set<string>): ResolveResult {
  const match = /^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value.trim());
  if (match === null) return { status: "ok", value };
  const ref = match[1];
  if (seen.has(ref)) return { status: "circular", ref };
  const target = props.get(ref);
  if (target === undefined) {
    return match[2] !== undefined
      ? { status: "ok", value: match[2].trim() }
      : { status: "missing", ref };
  }
  seen.add(ref);
  return resolveVar(target, props, seen);
}

function identityValue(value: CanonicalScalar["value"], unit?: CanonicalScalar["unit"]): CanonicalValue {
  const scalar: CanonicalScalar = unit === undefined ? { value } : { value, unit };
  return { sourceValue: scalar, resolvedValue: scalar };
}

function colorStruct(hex: string, alpha: number): ColorStruct {
  const [r, g, b] = hexToRgb(hex);
  return { colorSpace: "srgb", components: [r, g, b], alpha, hex };
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function resolvedModeValue(
  raw: JsonValue,
  value: CanonicalValue,
  alias?: { ref: string; resolved: true },
): CanonicalModeValue {
  return {
    status: "resolved",
    raw,
    resolvedValue: value,
    ...(alias !== undefined ? { alias } : {}),
  };
}

type TokenKindHint = "color" | "spacing" | "radius" | "font-size" | "line-height" | "letter-spacing" | "font-weight" | "font-family" | "duration";

function kindHintFor(name: string): TokenKindHint | undefined {
  if (/^--color-/i.test(name)) return "color";
  if (/^--space-|^--spacing-/i.test(name)) return "spacing";
  if (/^--radius-/i.test(name)) return "radius";
  if (/^--font-size-/i.test(name)) return "font-size";
  if (/^--line-height-/i.test(name)) return "line-height";
  if (/^--letter-spacing-/i.test(name)) return "letter-spacing";
  if (/^--font-weight-/i.test(name)) return "font-weight";
  if (/^--font-/i.test(name)) return "font-family";
  if (/^--duration-/i.test(name)) return "duration";
  return undefined;
}

interface NormalizedToken {
  type: CanonicalToken["type"];
  kind?: CanonicalToken["kind"];
  value: CanonicalValue;
  alias?: { ref: string; resolved: true };
}

type NormalizeResult =
  | { status: "ok"; token: NormalizedToken }
  | { status: "lossy"; reason: string; original: JsonValue; scalar: CanonicalScalar; token: NormalizedToken }
  | { status: "unsupported"; reason: string; raw: JsonValue; candidates?: string[] };

function normalizeValue(raw: string, hint: TokenKindHint | undefined): NormalizeResult {
  const text = raw.trim();

  if (hint === "font-family") {
    return { status: "ok", token: { type: "fontFamily", value: identityValue(text) } };
  }
  if (hint === "font-weight") {
    const numeric = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 1000) {
      return { status: "ok", token: { type: "fontWeight", value: identityValue(numeric) } };
    }
    if (text !== "") {
      return { status: "ok", token: { type: "fontWeight", value: identityValue(text) } };
    }
    return { status: "unsupported", reason: "font-weight 값 해석 불가", raw: text };
  }
  if (hint === "duration") {
    const match = DURATION_RE.exec(text);
    if (match !== null) {
      return {
        status: "ok",
        token: { type: "duration", value: identityValue(Number.parseFloat(match[1]), match[2] as "ms" | "s") },
      };
    }
    return { status: "unsupported", reason: `duration 값 해석 불가: ${text}`, raw: text };
  }
  if (hint === "color") {
    const color = parseSvgColor(text);
    if (color !== null) {
      return {
        status: "ok",
        token: { type: "color", value: identityValue(colorStruct(color.hex, color.alpha)) },
      };
    }
    return { status: "unsupported", reason: `color 값 해석 불가: ${text}`, raw: text };
  }

  // dimension 계열 (spacing/radius/font-size/line-height/letter-spacing)
  const length = LENGTH_RE.exec(text);
  if (length !== null) {
    const kind = hint === "line-height" ? "line-height"
      : hint === "letter-spacing" ? "letter-spacing"
        : hint === "radius" ? "radius"
          : hint === "font-size" ? "font-size"
            : hint === "spacing" ? "spacing" : undefined;
    const unit = length[2] as "px" | "rem" | "%";
    const value = Number.parseFloat(length[1]);
    if (hint === "line-height" && unit === "%") {
      // #30 4.4 — percent-to-ratio 변환.
      return {
        status: "ok",
        token: {
          type: "number",
          kind: "line-height",
          value: {
            sourceValue: { value, unit: "%" },
            resolvedValue: { value: value / 100 },
            conversion: { kind: "percent-to-ratio" },
          },
        },
      };
    }
    return {
      status: "ok",
      token: {
        type: "dimension",
        ...(kind !== undefined ? { kind } : {}),
        value: identityValue(value, unit),
      },
    };
  }
  const unitMatch = UNIT_SUFFIX_RE.exec(text);
  if (unitMatch !== null) {
    const scalar: CanonicalScalar = { value: text };
    return {
      status: "lossy",
      reason: `비표준 단위 "${unitMatch[2]}" — px/rem/%만 지원 (원문 보존)`,
      original: text,
      scalar,
      token: { type: "dimension", value: { sourceValue: scalar, resolvedValue: scalar } },
    };
  }
  if (NUMBER_RE.test(text)) {
    if (hint === "line-height") {
      return {
        status: "ok",
        token: { type: "number", kind: "line-height", value: identityValue(Number(text)) },
      };
    }
    return { status: "ok", token: { type: "number", value: identityValue(Number(text)) } };
  }

  // 색상 형태 fallback
  const color = parseSvgColor(text);
  if (color !== null) {
    return { status: "ok", token: { type: "color", value: identityValue(colorStruct(color.hex, color.alpha)) } };
  }
  return { status: "unsupported", reason: `값 분류 불가: ${text}`, raw: text };
}

/** tokens.css → canonical 문서 (9장). */
export function extractTokensToCanonical(css: string, options: CssTokenExtractOptions): CssTokenExtractResult {
  const props = new Map(extractCssCustomProperties(css).map((declaration) => [declaration.name, declaration.value]));
  const id12 = sourceId12(options.sourceId);
  const tokens: CanonicalToken[] = [];
  const unsupported: CanonicalLossItem[] = [];
  const ambiguous: CanonicalLossItem[] = [];
  const lossy: CanonicalLossItem[] = [];

  for (const [name, rawValue] of props) {
    const tokenId = `open-design:${id12}:${name}`;
    const path = name;
    const hint = kindHintFor(name);
    const resolved = resolveVar(rawValue, props, new Set([name]));

    if (resolved.status === "missing" || resolved.status === "circular") {
      unsupported.push({
        tokenId,
        path,
        mode: "default",
        code: "css-var-unresolved",
        reason: resolved.status === "missing"
          ? `var(${resolved.ref}) 미정의 — 해석 불가`
          : `var(${resolved.ref}) 순환 참조 — 해석 불가`,
        raw: rawValue,
        candidates: [resolved.ref],
      });
      // 타입을 알 수 없으므로 토큰을 생성하지 않고 unsupported로만 보고 (부분 성공 금지).
      continue;
    }

    const normalized = normalizeValue(resolved.value, hint);
    if (normalized.status === "unsupported") {
      unsupported.push({
        tokenId,
        path,
        mode: "default",
        code: "unsupported-category",
        reason: normalized.reason,
        raw: normalized.raw,
        ...(normalized.candidates !== undefined ? { candidates: normalized.candidates } : {}),
      });
      continue;
    }

    const varRef = /^var\(\s*(--[a-zA-Z0-9_-]+)/.exec(rawValue.trim());
    const alias = varRef !== null && props.has(varRef[1])
      ? { ref: `open-design:${id12}:${varRef[1]}`, resolved: true as const }
      : undefined;
    const token: CanonicalToken = {
      id: tokenId,
      name: name.slice(2),
      path,
      type: normalized.token.type,
      ...(normalized.token.kind !== undefined ? { kind: normalized.token.kind } : {}),
      values: { default: resolvedModeValue(rawValue, normalized.token.value, alias) },
      ...(options.semanticRoleOverrides?.[name] !== undefined
        ? { semanticRole: { role: options.semanticRoleOverrides[name], confidence: "explicit" as const } }
        : {}),
      provenance: { adapter: "open-design", sourcePath: path, sourceId: options.sourceId },
    };
    tokens.push(token);

    if (normalized.status === "lossy") {
      lossy.push({
        tokenId,
        path,
        mode: "default",
        code: "nonstandard-unit",
        reason: normalized.reason,
        original: normalized.original,
        converted: normalized.scalar,
      });
    }
  }

  const document: CanonicalTokenDocument = {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    document: {
      id: `canonical:open-design:${id12}`,
      sourceAdapter: "open-design",
      sourceName: options.sourceName,
      sourceRevision: options.contentHash,
    },
    tokens: [],
    importLoss: { unsupported, ambiguous, lossy },
  };
  document.tokens = tokens;
  return { document: sortCanonicalDocument(document) };
}

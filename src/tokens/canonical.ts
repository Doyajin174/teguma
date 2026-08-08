/**
 * canonical 문서 결정론·정렬·직렬화 (명세 4.8)와 projection 공통 계약 (6.1).
 *
 * - 동일 입력은 동일 canonical JSON과 동일 loss manifest를 생성한다(원칙 2).
 * - 타임스탬프·랜덤 id·가변 순서 금지.
 * - projection은 canonical 문서를 수정하지 않고 결과의 `loss`에 손실을 담는다(6.1).
 */

import {
  CanonicalTokenDocumentSchema,
  type CanonicalLossItem,
  type CanonicalLossManifest,
  type CanonicalToken,
  type CanonicalTokenDocument,
  type CanonicalValue,
  type ModeValues,
} from "./schema.js";

export type ProjectionMode = "light" | "dark" | "default";

/** 6.1 — projection 공통 계약. 소비자별 손실은 문서가 아니라 결과에 귀속. */
export interface ProjectionResult<T> {
  value: T;
  loss: ProjectionLossManifest;
}

/** 6.1 — 4.6과 같은 category 구조. code 어휘는 projection마다 정의한다. */
export type ProjectionLossManifest = CanonicalLossManifest;

/** 빈 loss manifest — projection의 시작점. */
export function emptyLossManifest(): ProjectionLossManifest {
  return { unsupported: [], ambiguous: [], lossy: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.8 결정론 정렬 규칙
// ─────────────────────────────────────────────────────────────────────────────

const MODE_ORDER: Record<"default" | "light" | "dark", number> = {
  default: 0,
  light: 1,
  dark: 2,
};

/** locale 무관 바이트 순 (UTF-8). */
export function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function compareMode(
  a: "default" | "light" | "dark" | undefined,
  b: "default" | "light" | "dark" | undefined,
): number {
  const ia = a === undefined ? -1 : MODE_ORDER[a];
  const ib = b === undefined ? -1 : MODE_ORDER[b];
  return ia - ib;
}

/** 4.8(3) — tokenId(없으면 path) → mode → code → raw 직렬화. */
export function compareLossItems(a: CanonicalLossItem, b: CanonicalLossItem): number {
  return (
    compareBytes(a.tokenId ?? a.path, b.tokenId ?? b.path)
    || compareMode(a.mode, b.mode)
    || compareBytes(a.code, b.code)
    || compareBytes(JSON.stringify(a.raw ?? null), JSON.stringify(b.raw ?? null))
  );
}

/** 4.8(1) — tokens: id 오름차순. */
export function sortTokens(tokens: CanonicalToken[]): CanonicalToken[] {
  return [...tokens].sort((a, b) => compareBytes(a.id, b.id));
}

export function sortLossItems(items: CanonicalLossItem[]): CanonicalLossItem[] {
  return [...items].sort(compareLossItems);
}

/** 4.8(3) — category 고정 순서 unsupported → ambiguous → lossy, 항목별 정렬. */
export function sortImportLoss(loss: CanonicalLossManifest): CanonicalLossManifest {
  return {
    unsupported: sortLossItems(loss.unsupported),
    ambiguous: sortLossItems(loss.ambiguous),
    lossy: sortLossItems(loss.lossy),
  };
}

/** 4.8 — values 키를 default → light → dark 순서로 재구성. */
export function normalizeModeValues(values: ModeValues): ModeValues {
  const ordered: ModeValues = {};
  if (values.default !== undefined) ordered.default = values.default;
  if (values.light !== undefined) ordered.light = values.light;
  if (values.dark !== undefined) ordered.dark = values.dark;
  return ordered;
}

/** 4.8 — 문서 전체를 고정 정렬 규칙에 따라 정렬한 사본을 돌려준다. */
export function sortCanonicalDocument(doc: CanonicalTokenDocument): CanonicalTokenDocument {
  const tokens = sortTokens(doc.tokens).map((token) => ({
    ...token,
    values: normalizeModeValues(token.values),
  }));
  return {
    ...doc,
    tokens,
    importLoss: sortImportLoss(doc.importLoss),
  };
}

/** 4.8 — 문서가 정렬 규칙을 지키는지 검증한다(위반 시 throw). */
export function assertCanonicalDocumentSorted(doc: CanonicalTokenDocument): void {
  for (let index = 1; index < doc.tokens.length; index += 1) {
    if (compareBytes(doc.tokens[index - 1].id, doc.tokens[index].id) > 0) {
      throw new Error(
        `canonical tokens are not sorted by id: ${doc.tokens[index - 1].id} > ${doc.tokens[index].id}`,
      );
    }
  }
  for (const token of doc.tokens) {
    const keys = Object.keys(token.values);
    const expected = ["default", "light", "dark"].filter(
      (key) => token.values[key as keyof ModeValues] !== undefined,
    );
    if (keys.join(",") !== expected.join(",")) {
      throw new Error(`values key order violation for ${token.id}: ${keys.join(",")}`);
    }
  }
  for (const category of ["unsupported", "ambiguous", "lossy"] as const) {
    const items = doc.importLoss[category];
    for (let index = 1; index < items.length; index += 1) {
      if (compareLossItems(items[index - 1], items[index]) > 0) {
        throw new Error(`importLoss.${category} is not sorted at index ${index}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 직렬화·파싱
// ─────────────────────────────────────────────────────────────────────────────

/** 결정론 직렬화 — 정렬 후 고정 포맷 JSON. */
export function serializeCanonicalDocument(doc: CanonicalTokenDocument): string {
  return `${JSON.stringify(sortCanonicalDocument(doc), null, 2)}\n`;
}

/** JSON 문자열 → 스키마 검증 + 정렬 정규화. */
export function parseCanonicalDocument(source: string): CanonicalTokenDocument {
  const parsed = CanonicalTokenDocumentSchema.parse(JSON.parse(source) as unknown);
  return sortCanonicalDocument(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.2 mode 해석 규칙 (projection 공통)
// ─────────────────────────────────────────────────────────────────────────────

export type ModeValueResolution =
  | { kind: "ok"; value: CanonicalValue }
  | { kind: "unresolved" }
  | { kind: "missing" };

/**
 * 4.2 규칙: 요청 mode → 없으면 `default` → 없으면 missing.
 * light↔dark 교차 fallback 없음 — projection별 세분 code로 보고한다.
 */
export function resolveTokenModeValue(
  token: CanonicalToken,
  mode: ProjectionMode,
): ModeValueResolution {
  const selected = token.values[mode] ?? token.values.default;
  if (selected === undefined) return { kind: "missing" };
  if (selected.status === "unresolved") return { kind: "unresolved" };
  return { kind: "ok", value: selected.resolvedValue };
}

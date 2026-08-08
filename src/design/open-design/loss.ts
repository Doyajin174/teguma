/**
 * loss report v0.1.0 (명세 11장).
 *
 * - category·severity·code 폐쇄 enum. 새 code 추가는 계약 변경(schemaVersion bump).
 * - original은 lossy 전용 원문(구조 보존, stringify 금지), converted는 #30
 *   CanonicalScalar 형태 ({ value, unit? }).
 * - 정렬 (#30 4.8 명시적 정합): severity 그룹 unsupported → ambiguous → lossy,
 *   항목 내 path 오름차순 → code 오름차순 → original 직렬화 → reason.
 *   token category는 tokenId(없으면 path) → mode(default→light→dark) → code.
 * - truncated 번들은 items 최상단에 partial-artifact 항목 (11장).
 */

import { z } from "zod";
import {
  CanonicalScalarSchema,
  JsonValueSchema,
  type CanonicalScalar,
  type JsonValue,
} from "../../tokens/schema.js";
import { compareBytes } from "../../tokens/canonical.js";

export const LOSS_REPORT_SCHEMA_VERSION = "0.1.0";

export const LossCategorySchema = z.enum(["text", "color", "frame", "layer", "image", "font", "token"]);
export const LossSeveritySchema = z.enum(["unsupported", "ambiguous", "lossy"]);
export const LossCodeSchema = z.enum([
  "unsupported-category",
  "nonstandard-unit",
  "unsupported-element",
  "external-url-asset",
  "embedded-image-v0.2",
  "font-license-unknown",
  "font-not-found",
  "text-as-path",
  "dropped-property",
  "css-var-unresolved",
  "baseline-estimated",
  "text-anchor-converted",
  "tspan-unresolved",
  "viewport-cropped",
  "partial-artifact",
]);

export type LossCategory = z.infer<typeof LossCategorySchema>;
export type LossSeverity = z.infer<typeof LossSeveritySchema>;
export type LossCode = z.infer<typeof LossCodeSchema>;

export const LossItemSchema = z.object({
  category: LossCategorySchema,
  severity: LossSeveritySchema,
  code: LossCodeSchema,
  path: z.string().min(1),
  reason: z.string(),
  original: JsonValueSchema.optional(),
  converted: CanonicalScalarSchema.optional(),
  tokenId: z.string().optional(),
  mode: z.enum(["default", "light", "dark"]).optional(),
});

export type LossItem = z.infer<typeof LossItemSchema>;

export const LossSummarySchema = z.object({
  layers: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
  text: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
  colors: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
  frames: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
  images: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
  fonts: z.object({ source: z.number().int(), imported: z.number().int(), unsupported: z.number().int(), lossy: z.number().int() }),
});

export type LossSummary = z.infer<typeof LossSummarySchema>;

export const LossReportSourceSchema = z.object({
  id: z.string().min(1),
  hash: z.string(),
  createdAt: z.string(),
  tool: z.string(),
  toolVersion: z.string(),
});

export const LossReportSchema = z.object({
  schemaVersion: z.literal(LOSS_REPORT_SCHEMA_VERSION),
  source: LossReportSourceSchema,
  summary: LossSummarySchema,
  items: z.array(LossItemSchema),
});

export type LossReport = z.infer<typeof LossReportSchema>;

/** summary 카테고리 키 (11장 — frames/colors/fonts 복수형). */
export type SummaryCategory = "layers" | "text" | "colors" | "frames" | "images" | "fonts";

const SEVERITY_ORDER: Record<LossSeverity, number> = { unsupported: 0, ambiguous: 1, lossy: 2 };
const MODE_ORDER: Record<"default" | "light" | "dark", number> = { default: 0, light: 1, dark: 2 };

function lossItemKey(item: LossItem): string {
  return item.category === "token" ? (item.tokenId ?? item.path) : item.path;
}

function modeIndex(mode: "default" | "light" | "dark" | undefined): number {
  return mode === undefined ? -1 : MODE_ORDER[mode];
}

/** 11장 정렬 — severity 그룹 → path(tokenId) → mode(token) → code → original → reason. */
export function compareLossItems(a: LossItem, b: LossItem): number {
  return (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || compareBytes(lossItemKey(a), lossItemKey(b))
    || (a.category === "token" || b.category === "token"
      ? modeIndex(a.mode) - modeIndex(b.mode)
      : 0)
    || compareBytes(a.code, b.code)
    || compareBytes(JSON.stringify(a.original ?? null), JSON.stringify(b.original ?? null))
    || compareBytes(a.reason, b.reason)
  );
}

export function sortLossItems(items: LossItem[]): LossItem[] {
  return [...items].sort(compareLossItems);
}

export function emptySummary(): LossSummary {
  const zero = { source: 0, imported: 0, unsupported: 0, lossy: 0 };
  return {
    layers: { ...zero },
    text: { ...zero },
    colors: { ...zero },
    frames: { ...zero },
    images: { ...zero },
    fonts: { ...zero },
  };
}

export interface LossReportInput {
  source: z.infer<typeof LossReportSourceSchema>;
  summary: LossSummary;
  items: LossItem[];
  truncated?: boolean;
}

/** loss report 생성 — 정렬 적용, truncated면 partial-artifact 항목을 최상단에 추가. */
export function buildLossReport(input: LossReportInput): LossReport {
  let items = sortLossItems(input.items);
  if (input.truncated === true) {
    items = [{
      category: "layer",
      severity: "unsupported",
      code: "partial-artifact",
      path: "svg://",
      reason: "get_artifact가 부분 산출물(truncated)을 반환 — 소스 파일 일부가 누락된 상태로 변환",
    }, ...items];
  }
  return {
    schemaVersion: LOSS_REPORT_SCHEMA_VERSION,
    source: input.source,
    summary: input.summary,
    items,
  };
}

export function addToSummary(
  summary: LossSummary,
  category: SummaryCategory,
  delta: { source?: number; imported?: number; unsupported?: number; lossy?: number },
): void {
  const target = summary[category];
  if (delta.source !== undefined) target.source += delta.source;
  if (delta.imported !== undefined) target.imported += delta.imported;
  if (delta.unsupported !== undefined) target.unsupported += delta.unsupported;
  if (delta.lossy !== undefined) target.lossy += delta.lossy;
}

/** canonical #30 importLoss 항목 → handoff loss item (token category). */
export function canonicalLossToHandoffItem(
  item: { tokenId?: string; path: string; mode?: "default" | "light" | "dark"; code: string; reason: string; original?: JsonValue; converted?: CanonicalScalar },
): LossItem {
  return {
    category: "token",
    severity: severityForCode(item.code),
    code: item.code as LossCode,
    path: item.path,
    reason: item.reason,
    ...(item.tokenId !== undefined ? { tokenId: item.tokenId } : {}),
    ...(item.mode !== undefined ? { mode: item.mode } : {}),
    ...(item.original !== undefined ? { original: item.original } : {}),
    ...(item.converted !== undefined ? { converted: item.converted } : {}),
  };
}

function severityForCode(code: string): LossSeverity {
  // canonical 어댑터 손실 코드 → handoff severity 매핑 (11장 어휘 정합).
  switch (code) {
    case "unsupported-category":
    case "unsupported-element":
    case "external-url-asset":
    case "embedded-image-v0.2":
    case "font-license-unknown":
    case "css-var-unresolved":
      return "unsupported";
    case "tspan-unresolved":
      return "ambiguous";
    default:
      return "lossy";
  }
}

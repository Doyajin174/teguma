/**
 * canonical design token contract v0.1.0 — Zod 스키마.
 *
 * 명세: docs/specs/018-canonical-token-contract.md 4장.
 * canonical은 Teguma의 lossless internal IR이다(DTCG 교환 문서가 아님 — 3장).
 * - 4.3: mode 값은 `z.discriminatedUnion("status", ...)` 필수.
 * - 4.2/4.3: 폐쇄 enum — CanonicalKind, UnresolvedReason 등 추가는 schemaVersion bump.
 * - 4.5: 타입 어휘는 DTCG 2025.10 tokenType 13종과 정렬, v0.1은 6종만.
 * - 새 런타임 의존성 없음 — 저장소 표준 zod v3.
 */

import { z } from "zod";

export const CANONICAL_SCHEMA_VERSION = "0.1.0";

/** JSON 값 — `raw`·`original`은 구조 보존(JSON 문자열 stringify 금지, 4.3·4.6). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

/** 4.2 — 폐쇄 enum. kind 추가는 계약 변경(schemaVersion bump). */
export const CanonicalKindSchema = z.enum([
  "spacing",
  "font-size",
  "line-height",
  "letter-spacing",
  "radius",
]);

/** 4.5 — v0.1 타입 어휘(DTCG 2025.10과 정렬, 6종). */
export const CanonicalTypeSchema = z.enum([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "number",
]);

/** 4.4 — 폐쇄 단위 union. 비표준 단위(em·vw 등)는 스칼라 value로 원문 보존 + lossy 보고. */
export const CanonicalUnitSchema = z.enum(["px", "rem", "ms", "s", "%"]);

/** 4.5 — DTCG 2025.10 공식 JSON Schema의 colorSpace 열거(본 문서 4.5 링크). */
export const ColorStructSchema = z.object({
  colorSpace: z.string(),
  components: z.array(z.number()),
  alpha: z.number().min(0).max(1).optional(),
  hex: z.string().optional(),
});

/** 4.4 — sourceValue → resolvedValue 변환 근거. */
export const ConversionRecordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rem-to-px"), rootFontSizePx: z.number() }),
  z.object({ kind: z.literal("percent-to-ratio") }),
  z.object({ kind: z.literal("identity") }),
]);

/** 4.4 — 정규화 값·단위. 소비자는 resolvedValue 기준. */
export const CanonicalScalarSchema = z.object({
  value: z.union([
    z.number(),
    z.string(),
    z.array(z.number()),
    z.array(z.string()),
    ColorStructSchema,
  ]),
  unit: CanonicalUnitSchema.optional(),
});

export const CanonicalValueSchema = z.object({
  sourceValue: CanonicalScalarSchema,
  resolvedValue: CanonicalScalarSchema,
  conversion: ConversionRecordSchema.optional(),
});

/** 4.3 — alias.ref는 logical id를 가리킨다(mode 포함 id 아님). */
export const ResolvedAliasSchema = z.object({
  ref: z.string(),
  resolved: z.literal(true),
});

export const UnresolvedAliasSchema = z.object({
  ref: z.string(),
  resolved: z.literal(false),
  reason: z.enum(["circular", "missing"]), // 폐쇄 union — 추가는 계약 변경
});

/** 4.3 — mode 값. discriminated union 필수. */
export const CanonicalModeValueSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("resolved"),
    raw: JsonValueSchema,
    resolvedValue: CanonicalValueSchema,
    alias: ResolvedAliasSchema.optional(),
  }),
  z.object({
    status: z.literal("unresolved"),
    raw: JsonValueSchema,
    alias: UnresolvedAliasSchema,
  }),
]);

/** 4.2 — mode별 values. 키 순서는 default → light → dark(4.8). */
export const ModeValuesSchema = z
  .object({
    default: CanonicalModeValueSchema.optional(),
    light: CanonicalModeValueSchema.optional(),
    dark: CanonicalModeValueSchema.optional(),
  })
  .superRefine((values, context) => {
    if (values.default === undefined && values.light === undefined && values.dark === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "token must declare at least one mode value",
        path: ["values"],
      });
    }
  });

/** 4.7 — semantic role 확실성. `mapped`(휴리스틱)는 소비자가 자동 확정 금지. */
export const SemanticRoleSchema = z.object({
  role: z.string().min(1),
  confidence: z.enum(["explicit", "mapped", "unknown"]),
});

export const ProvenanceSchema = z.object({
  adapter: z.enum(["penpot", "seed", "open-design"]), // v0.2: DTCG import 시 "dtcg" 추가 예정
  sourcePath: z.string(),
  sourceId: z.string(),
  collection: z.string().optional(),
});

/** 4.2 — logical token + mode별 values. 같은 원본 path의 light/dark는 한 객체에 병합. */
export const CanonicalTokenSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  path: z.string().min(1),
  type: CanonicalTypeSchema,
  kind: CanonicalKindSchema.optional(),
  values: ModeValuesSchema,
  semanticRole: SemanticRoleSchema.optional(),
  provenance: ProvenanceSchema,
  description: z.string().optional(),
});

/** 4.6 — import loss 항목. tokenId/path + mode + code로 구분. */
export const CanonicalLossItemSchema = z.object({
  tokenId: z.string().optional(),
  path: z.string().min(1),
  mode: z.enum(["default", "light", "dark"]).optional(),
  code: z.string().min(1),
  reason: z.string(),
  raw: JsonValueSchema.optional(),
  candidates: z.array(z.string()).optional(), // ambiguous 전용
  original: JsonValueSchema.optional(), // lossy 전용 — 원문 구조 보존
  converted: CanonicalScalarSchema.optional(), // lossy 전용
});

export const CanonicalLossManifestSchema = z.object({
  unsupported: z.array(CanonicalLossItemSchema),
  ambiguous: z.array(CanonicalLossItemSchema),
  lossy: z.array(CanonicalLossItemSchema),
});

/** 4.1 — 문서 뼈대. 타임스탬프 계열 필드 없음(결정론). */
export const CanonicalTokenDocumentSchema = z
  .object({
    schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
    document: z.object({
      id: z.string().min(1),
      sourceAdapter: z.enum(["penpot", "seed", "open-design"]), // v0.2: "dtcg" 추가 예정
      sourceName: z.string(),
      sourceRevision: z.string().optional(),
    }),
    tokens: z.array(CanonicalTokenSchema),
    importLoss: CanonicalLossManifestSchema,
  })
  .superRefine((doc, context) => {
    // 4.2 — 동일 logical id는 문서에 두 번 나타나지 않는다.
    const seen = new Set<string>();
    for (const [index, token] of doc.tokens.entries()) {
      if (seen.has(token.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate token id: ${token.id}`,
          path: ["tokens", index, "id"],
        });
      }
      seen.add(token.id);
    }
  });

export type CanonicalKind = z.infer<typeof CanonicalKindSchema>;
export type CanonicalType = z.infer<typeof CanonicalTypeSchema>;
export type CanonicalUnit = z.infer<typeof CanonicalUnitSchema>;
export type ColorStruct = z.infer<typeof ColorStructSchema>;
export type ConversionRecord = z.infer<typeof ConversionRecordSchema>;
export type CanonicalScalar = z.infer<typeof CanonicalScalarSchema>;
export type CanonicalValue = z.infer<typeof CanonicalValueSchema>;
export type CanonicalModeValue = z.infer<typeof CanonicalModeValueSchema>;
export type ModeValues = z.infer<typeof ModeValuesSchema>;
export type SemanticRole = z.infer<typeof SemanticRoleSchema>;
export type CanonicalToken = z.infer<typeof CanonicalTokenSchema>;
export type CanonicalLossItem = z.infer<typeof CanonicalLossItemSchema>;
export type CanonicalLossManifest = z.infer<typeof CanonicalLossManifestSchema>;
export type CanonicalTokenDocument = z.infer<typeof CanonicalTokenDocumentSchema>;

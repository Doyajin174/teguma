/**
 * LossItem 생성 헬퍼 — category·severity·code 폐쇄 enum 검증 (11장).
 */

import {
  LossCodeSchema,
  type LossCategory,
  type LossCode,
  type LossItem,
  type LossSeverity,
} from "./loss.js";
import type { CanonicalScalar, JsonValue } from "../../tokens/schema.js";

export type { LossItem } from "./loss.js";

export interface BuildLossItemInput {
  category: LossCategory;
  severity: LossSeverity;
  code: LossCode;
  path: string;
  reason: string;
  original?: JsonValue;
  converted?: CanonicalScalar;
}

/** 폐쇄 enum을 컴파일 타임+런타임에 검증하며 LossItem을 만든다. */
export function buildLossItem(input: BuildLossItemInput): LossItem {
  const code = LossCodeSchema.parse(input.code);
  return {
    category: input.category,
    severity: input.severity,
    code,
    path: input.path,
    reason: input.reason,
    ...(input.original !== undefined ? { original: input.original } : {}),
    ...(input.converted !== undefined ? { converted: input.converted } : {}),
  };
}

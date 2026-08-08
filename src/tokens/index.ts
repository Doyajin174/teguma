/**
 * canonical design token contract v0.1.0 — 공개 API.
 *
 * 명세: docs/specs/018-canonical-token-contract.md
 * - 스키마(4장) + 결정론 정렬(4.8) + projection 공통 계약(6.1).
 * - 어댑터: Penpot(5.1) · SEED(5.2) → canonical, canonical → BrandKit/
 *   DesignDocument(6.2) · Astryx(6.3).
 * - 기존 get_tokens/MCP 도구 계약은 변경하지 않는다(8장 — additive).
 */

export * from "./schema.js";
export * from "./canonical.js";
export * from "./adapters/penpot.js";
export * from "./adapters/seed.js";
export * from "./adapters/brandkit.js";
export * from "./adapters/astryx.js";

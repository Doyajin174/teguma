---
{
  "id": "process.qa-gate",
  "title": "QA 게이트",
  "aliases": ["QA gate", "품질 게이트"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["package.json", "test", "scripts"],
  "entrypoints": [
    {"path": "package.json", "anchor": "\"test\": \"vitest run\"", "role": "test-runner"},
    {"path": "scripts/verify-stock.mjs", "symbol": "verifyStockCollection", "role": "asset-validation"},
    {"path": "test/server.test.ts", "symbol": "MCP Server", "role": "server-regression"}
  ],
  "search_keys": ["vitest run", "verifyStockCollection"],
  "tests": [
    {"path": "test/server.test.ts", "symbol": "MCP Server", "role": "smoke-regression"},
    {"path": "test/edge-cases.test.ts", "symbol": "compressor edge cases", "role": "edge-regression"}
  ],
  "known_gaps": ["No single QA gate script or CI status aggregator was found; package scripts and Vitest files are the current validation boundaries."]
}
---

# QA 게이트

## Purpose and boundaries

현재 품질 검증의 실행 경계는 `npm test`가 호출하는 Vitest 전체 스위트와 자산 검증 스크립트다. 별도 통합 QA 오케스트레이터는 존재하지 않는다.

## Invariants

- `package.json`의 `test` 스크립트는 `vitest run`으로 현재 `test/` 검증을 선택한다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 핵심 로직 변경 | 해당 소스와 관련 `test/*.test.ts` | `npm test` |
| 자산 검증 변경 | `scripts/verify-stock.mjs:verifyStockCollection` | 관련 stock 테스트 |

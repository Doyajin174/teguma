---
{
  "id": "domain.brand-kit",
  "title": "브랜드 키트",
  "aliases": ["brand kit", "design tokens"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src", "test"],
  "entrypoints": [
    {"path": "src/penpot/types.ts", "symbol": "BrandContext", "role": "brand-contract"},
    {"path": "src/compressor.ts", "symbol": "compressBrandContext", "role": "token-extractor"},
    {"path": "src/tools/get-tokens.ts", "symbol": "getTokens", "role": "token-tool"},
    {"path": "src/tools/get-components.ts", "symbol": "getComponents", "role": "component-tool"}
  ],
  "search_keys": ["get_tokens", "get_components", "brand/"],
  "tests": [
    {"path": "test/compressor.test.ts", "symbol": "compresses colors with role inference", "role": "token-regression"},
    {"path": "test/tools.test.ts", "symbol": "get_tokens tool", "role": "tool-regression"}
  ],
  "known_gaps": ["No standalone brand-kit asset or persisted registry exists; the current canonical representation is derived from PenpotFile at runtime."]
}
---

# 브랜드 키트

## Purpose and boundaries

Penpot의 색상·타이포그래피·간격·컴포넌트 정보를 `BrandContext` 안에 보존하고 MCP 조회 결과로 노출한다. 브랜드 원본 파일과 외부 디자인 시스템 저장소는 제외된다.

## Invariants

- 색상 역할 추론과 토큰 압축은 `compressBrandContext`를 통해 한 번 수행되며, `getTokens`는 그 결과를 범주별로 필터링한다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 토큰 필드/범주 변경 | `src/penpot/types.ts:BrandContext`, `src/compressor.ts:compressBrandContext` | `test/compressor.test.ts`, `test/tools.test.ts` |

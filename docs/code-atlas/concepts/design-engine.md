---
{
  "id": "feature.design-engine",
  "title": "디자인 엔진",
  "aliases": ["brand context engine"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src", "test"],
  "entrypoints": [
    {"path": "src/compressor.ts", "symbol": "compressBrandContext", "role": "canonical-source"},
    {"path": "src/compressor.ts", "symbol": "serializeForLLM", "role": "llm-output"},
    {"path": "src/penpot/types.ts", "symbol": "BrandContext", "role": "data-contract"}
  ],
  "search_keys": ["get_design_context"],
  "tests": [
    {"path": "test/compressor.test.ts", "symbol": "compressBrandContext", "role": "regression"},
    {"path": "test/tools.test.ts", "symbol": "get_design_context tool", "role": "integration"}
  ],
  "known_gaps": ["src/compressor.ts has uncommitted user changes in the worktree context; reviewed_commit remains the last committed snapshot."]
}
---

# 디자인 엔진

## Purpose and boundaries

Penpot 파일에서 토큰·컴포넌트·페이지·레이아웃 제약을 압축해 AI 소비용 `BrandContext`와 compact text로 변환한다. Penpot 통신과 MCP 등록은 이 카드의 경계 밖이다.

## Invariants

- 기본 컴포넌트 상한은 50개이며, 출력은 전체 HTML/CSS가 아닌 구조 중심 표현이다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 압축 필드 변경 | `src/compressor.ts:compressBrandContext` | `test/compressor.test.ts`, `test/edge-cases.test.ts` |
| LLM 출력 변경 | `src/compressor.ts:serializeForLLM` | `test/compressor.test.ts` |

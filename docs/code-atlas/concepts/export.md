---
{
  "id": "feature.export",
  "title": "내보내기",
  "aliases": ["export", "LLM output"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src", "test"],
  "entrypoints": [
    {"path": "src/tools/get-design-context.ts", "symbol": "getDesignContext", "role": "export-entrypoint"},
    {"path": "src/compressor.ts", "symbol": "serializeForLLM", "role": "compact-serializer"},
    {"path": "src/penpot/types.ts", "symbol": "BrandContext", "role": "structured-export-contract"}
  ],
  "search_keys": ["compact", "json", "serializeForLLM"],
  "tests": [
    {"path": "test/tools.test.ts", "symbol": "returns JSON when requested", "role": "json-export-regression"},
    {"path": "test/compressor.test.ts", "symbol": "produces compact text output", "role": "text-export-regression"}
  ],
  "known_gaps": ["No file download, image export, or standalone export command exists; current export means MCP text or JSON response from get_design_context."]
}
---

# 내보내기

## Purpose and boundaries

`getDesignContext`가 압축된 브랜드 컨텍스트를 compact text 또는 JSON으로 반환하는 출력 경계다. 파일·이미지·Penpot 문서 다운로드는 현재 범위에 없다.

## Invariants

- 기본 형식은 `compact`이며, `format=json`일 때만 구조화된 JSON을 반환한다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 출력 형식 변경 | `src/tools/get-design-context.ts:getDesignContext`, `src/compressor.ts:serializeForLLM` | `test/tools.test.ts`, `test/compressor.test.ts` |

---
{
  "id": "integration.mcp-tools",
  "title": "MCP 도구",
  "aliases": ["MCP tools"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src/server.ts", "src/tools", "test"],
  "entrypoints": [
    {"path": "src/server.ts", "symbol": "createServer", "role": "tool-registry"},
    {"path": "src/tools/get-design-context.ts", "symbol": "getDesignContext", "role": "read-tool"},
    {"path": "src/tools/create-element.ts", "symbol": "createElement", "role": "write-tool"},
    {"path": "src/tools/import-figma.ts", "symbol": "importFigma", "role": "bridge-tool"}
  ],
  "search_keys": ["get_design_context", "get_tokens", "get_components", "get_constraints", "get_page_layout", "create_element", "import_figma"],
  "tests": [
    {"path": "test/server.test.ts", "symbol": "MCP Server", "role": "registration-regression"},
    {"path": "test/tools.test.ts", "symbol": "get_design_context tool", "role": "tool-regression"}
  ],
  "known_gaps": ["The server registers additional mutation and health tools; this card records representative read, write, and bridge boundaries rather than an exhaustive call graph."]
}
---

# MCP 도구

## Purpose and boundaries

`createServer`가 Penpot 조회·변경·Figma 임포트 도구를 MCP 이름으로 등록하고 각 구현 함수로 위임한다. MCP SDK 자체와 Penpot API 구현은 별도 카드다.

## Invariants

- 도구 이름은 서버 등록 문자열과 구현 파일의 exported 함수가 함께 바뀌어야 한다.
- `import_figma`는 기본적으로 `dryRun=true`인 미리보기 경로를 가진다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 도구 추가/이름 변경 | `src/server.ts:createServer`, 해당 `src/tools/*.ts` | `test/server.test.ts`, `test/tools.test.ts` |

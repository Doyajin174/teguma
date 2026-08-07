---
{
  "id": "feature.web-editor",
  "title": "웹 에디터",
  "aliases": ["web editor"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src", "test"],
  "entrypoints": [
    {"path": "src/index.ts", "symbol": "startServer", "role": "nearest-runtime-boundary"},
    {"path": "src/server.ts", "symbol": "createServer", "role": "nearest-service-boundary"}
  ],
  "search_keys": ["teguma"],
  "tests": [
    {"path": "test/server.test.ts", "symbol": "MCP Server", "role": "runtime-regression"}
  ],
  "known_gaps": ["No web/ directory or web editor implementation exists in the reviewed repository; the recorded entrypoints are the closest MCP runtime boundary, not an editor UI."]
}
---

# 웹 에디터

## Purpose and boundaries

현재 저장소에는 웹 에디터가 없으며, CLI가 시작하는 MCP 서버가 가장 가까운 실행 경계다. UI 라우트·브라우저 상태·편집 캔버스는 제외된다.

## Invariants

- `src/index.ts`는 환경변수/CLI 인자로 Penpot 연결 설정을 받아 `startServer`를 호출한다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| 웹 에디터 신규 구현 | `src/index.ts:startServer`, `src/server.ts:createServer` | 새 `web/` 경계와 별도 UI 테스트 필요 |

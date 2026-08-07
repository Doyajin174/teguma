---
{
  "id": "integration.penpot-bridge",
  "title": "Penpot 브릿지",
  "aliases": ["Penpot bridge"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src/penpot", "src/tools", "test"],
  "entrypoints": [
    {"path": "src/penpot/client.ts", "symbol": "PenpotClient", "role": "api-client"},
    {"path": "src/penpot/types.ts", "symbol": "PenpotFile", "role": "normalized-contract"},
    {"path": "src/server.ts", "symbol": "ServerConfig", "role": "connection-config"}
  ],
  "search_keys": ["get-project-files", "commit-changes", "PENPOT_URL", "PENPOT_TOKEN"],
  "tests": [
    {"path": "test/server.test.ts", "symbol": "creates server with valid config", "role": "connection-regression"},
    {"path": "test/tools.test.ts", "symbol": "createMockClient", "role": "consumer-contract"}
  ],
  "known_gaps": ["Live Penpot API behavior is not exercised by the repository test suite.", "src/penpot/client.ts has uncommitted user changes in the worktree context; reviewed_commit remains the last committed snapshot."]
}
---

# Penpot 브릿지

## Purpose and boundaries

Penpot RPC/HTTP 응답을 `PenpotFile` 계열 내부 타입으로 정규화하고 파일 조회와 변경 커밋을 제공한다. MCP 도구의 사용자 경험과 외부 Penpot 인스턴스 운영은 제외된다.

## Invariants

- 클라이언트가 반환하는 도메인 객체는 `src/penpot/types.ts`의 정규화 타입을 따른다.
- 변경 도구는 Penpot의 `commit-changes` 경계를 통해 쓰기 작업을 수행한다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| RPC 메서드/응답 변경 | `src/penpot/client.ts:PenpotClient` | 소비 도구와 `test/tools.test.ts` |

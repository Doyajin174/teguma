# Open Design export capability 실측 조사 — 공식/비공식 경계와 Penpot 수용 경로

> 조사일: 2026-08-08
>
> 관련 이슈: [#32](https://github.com/Doyajin174/teguma/issues/32) — Refs #19 #29 #30
>
> 상태: 확정 — MCP 등록 상태·데몬 청크·공식 스킬 문서·teguma 코드·로컬 Penpot RPC 기준 실측 (리뷰 반영: 2026-08-08, PR #34)

## 1. 결론

Open Design은 "디자인 문서"를 내보내는 도구가 아니라 **웹 아티팩트(HTML/CSS/JS/JSX/SVG/Markdown 파일 트리)를 생성하는 도구**다. MCP 표면에는 전용 export/download 도구가 없고, 기본 전달은 `previewUrl`/`studioUrl` 링크다. 공식적으로 기계 판독 가능한 산출물은 **`get_artifact`로 얻는 프로젝트 소스 파일 트리(텍스트 파일 한정)** 하나이며, 바이너리(이미지·폰트)는 메타데이터만 조회 가능하다.

따라서 이슈 #32의 핸드오프 형식은 **SVG 단일 파일(primary) + CSS 커스텀 프로퍼티 토큰(보조, canonical 계약 #30 정렬) + 명시적 사용자 handoff 번들**로 확정한다 (상세: [docs/specs/019-open-design-handoff.md](../specs/019-open-design-handoff.md)). preview URL scraping 같은 비공식 우회는 채택하지 않는다.

## 2. 실측 범위·방법

| 항목 | 방법 | 결과 |
| --- | --- | --- |
| MCP 등록 상태 | `codex mcp get open-design --json` | enabled, stdio, `daemon-cli.mjs mcp` (Open Design Helper), `OD_DATA_DIR=.../release-stable/data` |
| 이 세션 도구 노출 | `tool_search`로 open-design 검색 시도 | **도구 미노출** — 이 세션 MCP 스냅샷에 open-design 도구 없음 (pencil/supershorts 등 무관 도구만 반환) |
| 도구 표면·결과 필드 | 설치본 데몬 번들 `.../prebundled/daemon/chunks/*.mjs` 텍스트 검색 | `collect_brief`·`start_run`·`get_run`·`get_artifact` 등 20여 개 도구 확인, 결과 필드(아래 3장) 실측 |
| 공식 사용 절차 | 플러그인 번들 `open-design/0.5.2/skills/open-design-mode/SKILL.md` | 실행 모드 3종(cloud/local-codex/BYOK), 브리프→런→폴링→전달 게이트, `get_artifact` 용도(소스 컨텍스트 전용) 확인 |
| 공식 웹 문서 | open-design.ai (/)·(/download) HTML 조회 | 마케팅·다운로드 페이지. export/download API 문서 없음 |
| Penpot 수용 경로 | `src/penpot/client.ts`, `src/tools/create-element.ts`, `src/figma/converter.ts`, 읽기 도구 | `add-obj` RPC 기반 생성(rectangle/ellipse/text/board/svg), 단 svg 타입은 placeholder (아래 6장) |
| Penpot 페이지 생성 RPC | 로컬 Penpot(192.168.0.183:9001) `/api/rpc/command/` 직접 호출 (2026-08-08) | `create-page`·`add-page`·`duplicate-page`·`rename-page`·`delete-page` 전부 `~:not-found` (미노출) — 페이지 생성은 `update-file` changes의 `add-page` 변화 타입으로만 가능 (아래 6.1) |
| Penpot path 셰이프 생성 | 로컬 Penpot `update-file` `add-obj` 실측 (2026-08-08) | `type: "path"` 생성 **성공** — `content`·`selrect`·`points`(4)·`transform`/`transform-inverse`·`parent-id`/`frame-id` 요구, 생성→재조회 왕복 확인 (아래 6.1) |

> **세션 한계**: 이 태스크에서는 open-design MCP 도구가 로드되지 않아 실제 생성(run)을 실행할 수 없었다. 이는 공식 스킬 문서의 안내("현재 Codex 태스크가 새 MCP 스냅샷을 hot-load하지 못하면 새 태스크 시작")와 일치하는 환경 제약이며, live smoke는 구현 단계의 새 태스크에서 수행한다 (명세 13장).

## 3. Open Design MCP 도구 표면 (실측)

데몬 번들(`daemon-cli.mjs` → `chunks/`)과 SKILL.md 교차 확인 결과:

| 그룹 | 도구 | 실측 근거 (청크 텍스트) |
| --- | --- | --- |
| Brief | `collect_brief`, `confirm_brief` | 브리프 카드/문답, `questionForm` 폴백 |
| 인증(cloud) | `get_vela_login_status`, `start_vela_login` | 로그인 상태/활성화 URL·유저 코드 |
| 런타임 선택 | `list_agents`, `list_byok_profiles` | `amr`(cloud)·`codex`(local)·`byok-opencode`·BYOK 프로필 |
| 프로젝트 | `get_active_context`, `list_projects`, `create_project`, `get_project` | 활성 컨텍스트·프로젝트 생성/조회 |
| 생성·폴링 | `start_run`, `get_run` | 아래 3.1 |
| 파일(아티팩트 컨텍스트) | `get_artifact`, `list_files`, `get_file`, `search_files`, `write_file`, `delete_file` | 아래 3.2 |

### 3.1 `start_run` / `get_run` 결과 필드

- `start_run` → `runId` (1회 호출, 동일 `requestId`로 재시도 허용, `resume` 지원).
- `get_run` → `status: queued | running | succeeded | failed | canceled`.
- 성공 시: `previewUrl`(브라우저 렌더 링크), `studioUrl`(스튜디오 페이지), `agentMessage`(내부 에이전트 텍스트 출력), `projectId`, `eventsLogPath`(포렌식용 이벤트 로그).
- **링크가 기본 전달**이다: "previewUrl: open in a browser to view the rendered design directly", "the Preview/Studio reference is the default delivery".
- `get_artifact`는 전달 링크 제조용이 아니라 **소스 컨텍스트가 정말 필요할 때만** 호출하도록 규정 (SKILL.md "Optional artifact context").

### 3.2 `get_artifact` / `get_file` — 공식 기계 판독 경로

- `get_artifact([project, entry])`: 엔트리 파일 + 참조 형제 파일 번들. HTML `<script>/<link>/<img>/srcset`, JSX `import/require`, CSS `url()/@import`를 **깊이 3까지** 추적하고 **CDN/data URL은 skip**한다. `include="all"`이면 전체 파일.
- 반환 필드: 파일 엔트리(`entryFile`, `kind`, `timestamps`, `resolvedDir`), 엔트리가 있으면 브라우저 열람용 `previewUrl`, `truncated`/`skippedFileCount`.
- 제한: **텍스트 총량 기본 1,500,000 바이트, 최대 200파일**. 초과 시 파일이 버려지고 `truncated: true`.
- `get_file`: 텍스트 MIME만 읽음 (**HTML, JSX, CSS, JSON, SVG, Markdown**). 바이너리 파일은 오류 — `list_files`로 메타데이터만.
- `write_file`: 파일 쓰기, 기존 대상 거부, `artifactManifest` 유지. **HTML/Markdown/SVG 엔트리는 manifest 미제공 시 기본 manifest 자동 생성** — SVG가 1급 아티팩트 종류임을 방증.

### 3.3 모드별 차이 (cloud / Local Codex / BYOK)

| 구분 | Open Design Cloud (기본) | Local Codex | secure BYOK |
| --- | --- | --- | --- |
| 런타임 | 로컬 데몬 + 번들 cloud 런타임, `agent: "amr"` | 로컬 Codex CLI(`agent: "codex"`) | 프로바이더 키(`byokProfile`) |
| 인증·비용 | cloud 계정 로그인, cloud 크레딧 | `codex login` 필요, 자체 비용 | 프로바이더 계정 비용 |
| 선택 조건 | 기본값 | 사용자 명시 선택만 | 사용자 명시 선택만 |
| **export 표면** | **동일** — 파일 트리·링크 전달 구조는 모드 무관 | 동일 | 동일 |
| provenance 차이 | `mode: "cloud"`, runId/projectId | `mode: "local-codex"` | `mode: "byok"` + 프로필 id |

→ export capability 관점에서 모드 차이는 **provenance(모드·도구·버전·비용 주체)뿐**이며, 기계 판독 산출물 계약은 모드와 무관하게 동일하다. 시크릿(cloud/BYOK 크레덴셜)은 MCP 내부에서만 다뤄지고 chat·파일·커밋에 노출 금지 (SKILL.md).

## 4. 기계 판독 가능 산출물 판정

| 산출물 | 공식 경로 | 판정 |
| --- | --- | --- |
| 프로젝트 소스 파일 트리 (HTML/JSX/CSS/JSON/SVG/Markdown) | `get_artifact` | ✅ **공식·기계 판독 가능** — 핸드오프 1차 소스 |
| preview/studio 링크 | `get_run` | ✅ 공식이지만 기계 판독 불가(렌더 뷰) — 사람 확인·시각 검증용 |
| SVG 단일 파일 | `get_artifact`(kind: svg) | ✅ 공식, Penpot native 수용 — **선택 형식 (primary)** |
| CSS 커스텀 프로퍼티 토큰 | `get_artifact`(kind: css) + 파싱 | ✅ 공식 — canonical 계약(#30) 정렬 경로 |
| 디자인 토큰 export (전용 도구) | 없음 | ❌ 미제공 |
| Figma/PNG/PDF 등 문서 export | 없음 | ❌ 미제공 |
| 바이너리 이미지·폰트 파일 | `get_file` 바이너리 오류 | ❌ 메타데이터(`list_files`)만 가능 — 외부 URL 참조만 남음 |
| 렌더 결과 픽셀 | previewUrl 브라우저 | ⚠️ scraping은 **비공식 우회 → 비채택** (이슈 비범위) |

## 5. 공식/비공식 경계

**공식 (채택)**

- `get_artifact`/`get_file`/`list_files`로 얻는 텍스트 파일 트리 — SKILL.md "Optional artifact context"에 규정된 정식 경로.
- 사용자가 명시적으로 제공한 산출물 파일 (같은 계약의 handoff 번들로 포장 — 명세 5장).

**비공식 (비채택, 이슈 비범위)**

- preview URL scraping·내부 렌더 캡처 — "preview URL scraping 같은 비공식 우회는 채택하지 않는다" (이슈 본문).
- Open Design 내부 저장소·비공개 API 직접 접근 (`OD_DATA_DIR` 네임스페이스 내부 조작 포함).

**한계 (공식 표면 자체의 제약)**

- 텍스트 1.5MB·200파일 cap → 대형 프로젝트는 `truncated` 처리되며, 이 경우 **부분 산출물임을 명시**해야 한다 (명세 11장).
- 외부 URL 이미지·폰트는 내용을 얻을 수 없어 라이선스·가용성 확인이 사람 책임으로 남는다 (명세 6장).
- 아티팩트의 구조 보존 단위는 "파일"이지 "레이어"가 아니므로, 레이어 수준 보존은 Penpot 변환 단계에서 정의해야 한다 (명세 7·8장).

## 6. Penpot 수용 경로 실측 (teguma 기준)

### 6.1 생성 경로

| 경로 | 상태 | 내용 |
| --- | --- | --- |
| `create_element` (type: rectangle/ellipse/text/board/svg) | 운영 중 (단, RPC 실측 주의 — 아래) | `commit-changes` RPC `add-obj`. 텍스트는 paragraph-set 구조, 보드는 frame. **로컬 인스턴스 실측에서 `commit-changes`는 미노출 — `update-file` 전환 필요 (아래 실측 블록)** |
| `create_element` (type: **svg**) | **placeholder** | 주석: "full SVG parsing would require server-side SVG → Penpot path conversion. For now, store as a rectangle placeholder with metadata" — **실제 SVG 파싱·셰이프 변환 미구현** |
| `import-figma` | 운영 중 | Figma 파일 → Penpot 컨버터 패턴 (`src/figma/converter.ts`) — adapter 구조의 선례 |
| Penpot native SVG import (UI 드래그드롭/파일 import) | Penpot 측 기능 | 서버측 SVG 파싱 → 셰이프 트리. teguma RPC 경로에는 미연결 — 구현 시 `import-file` RPC 비교 검토 (명세 7.3) |

**로컬 Penpot RPC 실측 (2026-08-08, 192.168.0.183:9001)** — teguma가 사용하는 `/api/rpc/command/` 표면을 직접 호출해 확인:

| RPC | 실측 결과 | 비고 |
| --- | --- | --- |
| `commit-changes` | **`~:not-found` (미노출)** | `client.ts`의 현재 쓰기 경로와 **불일치** — 이 인스턴스에서는 호출 불가 |
| `update-file` | **존재 — 실제 쓰기 경로** | `{ id, session-id, revn, vern, changes[] }`. changes 변화 타입: `add-obj`·`del-obj`·`mod-obj`·`add-page`·`mod-page`·`mov-page`·`mov-objects`·`reorder-children`·`set-guide` 등 |
| `add-page` (변화 타입) | **페이지 생성 경로** | `{ type: "add-page", id?, name?, page? }` — 독립 RPC 없이 이 변화 타입으로만 페이지 생성 가능 |
| `create-page` 계열 | `~:not-found` | `create-page`/`add-page`/`duplicate-page`/`rename-page`/`delete-page` 전부 미노출 |
| `get-files` | `~:not-found` (미노출) | `client.ts listFiles`의 이 경로도 이 인스턴스에서 동작하지 않음 (`get-projects`→`get-project`로 파일 조회) |
| **path 셰이프 `add-obj`** | **생성 성공 (왕복 확인)** | `type: "path"` 유효. 서버 스키마 요구 필드: `content`(path 명령, `penpot/path-data`로 인코딩), `selrect`(x/y/width/height/x1/y1/x2/y2), `points`(4점), `transform`/`transform-inverse`(identity), `parent-id`/`frame-id` |

→ **명세 영향**: (1) 쓰기 클라이언트는 `update-file` 기반으로 전환 필요 — 페이지 생성(`add-page`), 셰이프 생성(`add-obj`), 삭제(`del-obj`) 모두 이 RPC의 변화 타입으로 구현한다 (명세 7.2-5·7.3). (2) path 요소는 `add-obj`로 생성 가능하므로 POC 통과선에 포함한다 (명세 8.2). (3) 구현 전까지 idempotency는 기존 파일 내 페이지 교체로 제한 (명세 12장).

### 6.2 읽기 경로 (재조회)

- `get-page-layout` — 페이지 셰이프 트리(이름·타입·크기·레이아웃·중첩).
- `get-tokens` — 압축 토큰(colors/typography/spacing), `includeCanonical` 파라미터(#30 v0.1에서 추가 예정).
- `get-components` — 파일 컴포넌트.
- `get-design-context`, `get-constraints` — 브랜드 컨텍스트·레이아웃 제약.

### 6.3 canonical 계약 접점 (#30)

- `src/tokens/schema.ts`에 `sourceAdapter: z.enum(["penpot", "seed", "open-design"])` — **Open Design 어댑터가 이미 계약에 예약돼 있다** (명세 4.1, 5.3).
- 손실 어휘(`unsupported`/`ambiguous`/`lossy`), 결정론 정렬(4.8), provenance 규칙을 핸드오프 loss report에 준용한다.
- canonical 문서 자체는 타임스탬프 금지(결정론) — **생성 시각은 handoff 번들·import 기록의 provenance에만** 둔다 (명세 10장).

## 7. 선택한 handoff 형식 요약과 근거

상세는 [docs/specs/019-open-design-handoff.md](../specs/019-open-design-handoff.md) 4장. 요약:

1. **primary — SVG 단일 파일**: Open Design 공식 아티팩트 종류(SVG 엔트리, 기본 manifest) + Penpot native 수용 + 텍스트·색상·도형·레이어 보존 가능. HTML/CSS 전체 변환은 이슈 비범위.
2. **보조 — CSS 커스텀 프로퍼티 → canonical 토큰**: 색·타이포를 결정론적으로 추출, #30 계약과 정렬 (`sourceAdapter: "open-design"`).
3. **명시적 사용자 handoff 번들**: `get_artifact` 결과와 사용자 제공 파일을 같은 번들 계약(manifest.json + 파일 + provenance)으로 통일 — CI fixture가 네트워크·시크릿 없이 동일 변환을 검증할 수 있는 근거.
4. **비채택**: preview scraping, Open Design 내부 API, 임의 HTML/CSS 완전 변환, 픽셀 동일성.

## 8. 리스크

| 리스크 | 대응 |
| --- | --- |
| MCP 도구가 현재 태스크에 미노출 | 새 태스크에서 스냅샷 로드 (SKILL.md 안내). live smoke는 구현 단계 새 태스크에서 수행 |
| 텍스트 1.5MB·200파일 cap | 대형 프로젝트 `truncated` 명시, 손실 보고. POC는 작은 샘플 1개 |
| 바이너리 자산 미획득 | 외부 URL·라이선스는 사람 확인 항목으로 명시 (명세 6.3) |
| `create_element` svg placeholder | adapter가 SVG→Penpot 셰이프 변환을 구현 (명세 7장). Penpot native import 경로도 병행 검토 |
| Open Design 버전 변경으로 도구 표면 변화 | 도구 이름·필드 실측 시점(2026-08-08, 앱 0.18.1, 플러그인 0.5.2) 고정, 번들 계약으로 격리 |

> **리뷰 반영 (PR #34, Jason 리뷰 — 2026-08-08)**: H1 페이지 생성 RPC 실측(6.1), H2 path 셰이프 실측(6.1) 추가, M2 8장 참조 "(명세 6.4)"→"(명세 6.3)" 정정. 명세 측 반영 내역은 [명세 19장](../specs/019-open-design-handoff.md).

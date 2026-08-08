# Meta Astryx 디자인 시스템 조사

> 조사일: 2026-08-08
>
> 관련 이슈: [#23](https://github.com/Doyajin174/teguma/issues/23)
>
> 대상: [facebook/astryx](https://github.com/facebook/astryx) (`main`, Beta)

## 결론

Astryx는 캔버스 편집기나 디자인 파일 형식이 아니라, React 19+ 애플리케이션을 위한 UI 런타임이다. 따라서 teguma가 Astryx 컴포넌트를 직접 "생성"하거나 Penpot 요소와 1:1 동기화하는 것은 현재 책임 경계에 맞지 않는다. 반면 teguma가 Penpot에서 추출한 브랜드 토큰과 레이아웃 제약을 Astryx 테마 초안으로 변환하고, 호출 에이전트가 Astryx CLI로 적합한 컴포넌트·템플릿을 찾게 하는 조합은 자연스럽다.

권장 진입점은 **읽기 전용 토큰 변환 POC**다. `get_design_context`/`get_tokens`의 결과를 Astryx의 CSS custom property 기반 테마 입력으로 매핑해 검토 가능한 초안을 반환한다. Astryx는 공식 원격 MCP 서버도 제공하지만, 이는 개발 에이전트가 Astryx 문서·예제를 읽는 외부 인터페이스로만 사용한다. Astryx의 React 코드 생성, teguma MCP 도구의 변경, 또는 Astryx MCP의 프록시는 POC 결과와 별도 이슈의 승인 없이는 범위에 넣지 않는다.

## 1. 저장소 구조와 아키텍처

Astryx는 MIT 라이선스의 Beta 프로젝트이며 React 19+와 StyleX 위에 구축됐다. Meta 내부에서 장기간 사용됐으나, 공개 소비자는 StyleX 빌드 플러그인 없이도 사전 빌드한 CSS·JS를 가져다 쓸 수 있다. 따라서 소비자 애플리케이션은 StyleX를 채택하지 않아도 되고 `className`으로 Tailwind, CSS Modules, 일반 CSS를 함께 쓸 수 있다. [공식 저장소](https://github.com/facebook/astryx), [core README](https://github.com/facebook/astryx/blob/main/packages/core/README.md)

| 경로/패키지 | 역할 | teguma 관점 |
| --- | --- | --- |
| `apps/` | 예제 앱, 문서 사이트, Storybook | 컴포넌트 사용 예·시각 검증의 참고 자료 |
| `packages/core` (`@astryxdesign/core`) | 접근성 React 컴포넌트, 테마 시스템, 유틸리티 | 최종 React UI의 런타임 의존성 후보 |
| `packages/cli` (`@astryxdesign/cli`) | 문서, 검색, 템플릿, 테마 빌드, codemod | 에이전트가 컴포넌트 선택·코드 조합에 쓰는 공식 인터페이스 |
| `packages/build` (`@astryxdesign/build`) | StyleX 소스 빌드 플러그인 | POC의 필수 의존성 아님 |
| `packages/theme-*` | neutral·butter·chocolate·matcha·stone·gothic·y2k 테마 | 변환 결과의 기준 테마 또는 비교 대상으로 사용 |
| `internal/` | 테스트 유틸리티, ESLint 플러그인, vibe tests | 외부 연동 대상이 아닌 내부 개발 지원 코드 |

공식 구조는 foundations(타이포그래피·색상·레이아웃·접근성), components, patterns(테이블, 상세 페이지, 폼, 내비게이션 등)으로 설명된다. 컴포넌트의 하위 building block을 공개하고, 깊은 수정이 필요하면 `swizzle`로 소스를 프로젝트에 꺼내 소유할 수 있게 한다. [공식 저장소](https://github.com/facebook/astryx)

## 2. 토큰·테마 체계

Astryx 테마는 컴포넌트 fork나 wrapper가 아니라 **CSS custom property override 집합**이다. 기본 설치는 reset → Astryx 컴포넌트 → 선택한 theme CSS 순으로 import하며, 각각 `reset`, `astryx-base`, `astryx-theme` cascade layer에 놓인다. 런타임에서는 `Theme` provider가 선택한 built theme을 적용한다. [core 설치·테마 문서](https://github.com/facebook/astryx/blob/main/packages/core/README.md)

토큰 범주는 색상(텍스트·배경·테두리·상태·색상 팔레트), spacing, radius, shadow, typography를 포함한다. Tailwind 사용 시 `tailwind-theme.css`가 CSS 변수와 유틸리티를 이어 주며, 예를 들어 `--color-text-primary`, `--color-background-surface`, `--radius-container`, `--shadow-high`, `--spacing-4`를 해당 유틸리티에서 쓸 수 있다. [core README의 Tailwind token mapping](https://github.com/facebook/astryx/blob/main/packages/core/README.md)

teguma의 `get_tokens`는 현재 Penpot 색상·타이포그래피·간격을 구조화해 반환한다. Astryx의 전체 semantic token 집합을 손실 없이 역으로 재구성할 수는 없으므로, 변환기는 아래처럼 명시적인 대응 범위와 누락 보고를 가져야 한다.

| teguma 원천 | Astryx 대상 | 처리 원칙 |
| --- | --- | --- |
| 브랜드 팔레트 | semantic color override 후보 | 역할이 확인된 토큰만 텍스트·배경·테두리·상태에 배정, 의미가 없으면 후보 목록으로 남김 |
| 타이포그래피 | font family/weight/size 관련 override 후보 | 단위·fallback·라이선스는 원천 메타데이터와 함께 보존하고 자동 설치하지 않음 |
| spacing | `--spacing-*` scale 후보 | 원천 scale이 단조 증가하고 단위가 호환될 때만 매핑, 그렇지 않으면 경고 |
| radius/shadow | 대응 데이터가 있을 때만 override 후보 | 현재 `get_tokens` 기본 범주에 없으므로 추측 생성 금지 |
| light/dark 값 | theme의 light/dark 분기 | 원천에 두 모드가 모두 있을 때만 출력, 한 모드만 있으면 기준 테마 값을 유지 |

## 3. AI·에이전트 지향 워크플로

Astryx의 주된 machine interface는 `@astryxdesign/cli`이다. CLI와 그 programmatic API는 component, hook, docs, template, theme, migration 정보를 같은 방식으로 노출하며, 모든 명령은 typed JSON envelope와 안정적인 오류 코드를 지원한다. `manifest --json`은 명령·인자·응답 type을 한 번에 기술하므로 에이전트가 `--help`를 파싱하지 않아도 된다. `--dense`는 토큰을 아끼는 압축 출력이다. [공식 CLI 문서](https://astryx-canary.vercel.app/docs/cli)

| 목적 | Astryx 표면 | 에이전트 활용 |
| --- | --- | --- |
| 초기화 | `init` | `AGENTS.md`/`CLAUDE.md`에 관리된 컴포넌트 색인을 써서 추측 대신 공식 목록을 사용 |
| 탐색 | `search`, `component`, `hook`, `docs` | 요구에 맞는 컴포넌트, prop, 예제, 토큰 문서를 JSON/dense로 조회 |
| 화면 조합 | `build`, `layout`, `template` | 자연어 요구에서 가까운 page/block template과 구성 키트를 찾고 소스 초안을 받음 |
| 테마 | `theme build` | `defineTheme` 파일을 production CSS·JS로 컴파일 |
| 유지보수 | `upgrade`, `doctor`, `swizzle` | codemod, 설치 진단, 필요한 컴포넌트 소스 소유 |

공식 MCP 서버가 존재하며, 상세 계약은 아래 "검증 보강"에 기록했다. 이는 CLI를 대체하는 패키지형 서버가 아니라 Astryx가 호스팅하는 원격 문서·검색 인터페이스다. 이 이슈의 후속은 Astryx CLI를 teguma가 subprocess로 실행하는 방식도 즉시 채택하지 않으며, 버전 고정·입출력 계약·실행 권한을 별도 설계에서 검토한다.

## 검증 보강: 공식 MCP 서버 계약 (2026-08-08)

### 판정

**공식 독립 MCP 서버는 존재한다.** Astryx가 호스팅하는 Streamable HTTP 서버이며, MCP 호환 클라이언트는 다음 URL을 직접 연결한다.

```text
https://astryx.atmeta.com/mcp
```

저장소 `main`을 확인한 결과, 문서 사이트의 [`apps/docsite/src/app/mcp/route.ts`](https://github.com/facebook/astryx/blob/main/apps/docsite/src/app/mcp/route.ts)는 `mcp-handler`로 GET/POST/DELETE를 내보내고 Streamable HTTP transport를 사용한다. 같은 저장소의 [AI 작업 문서](https://github.com/facebook/astryx/blob/main/packages/cli/assets/docs/working-with-ai.doc.mjs)는 위 URL을 MCP 설정으로 제시한다. 검증 시점 `main` SHA는 [`0b5a38e`](https://github.com/facebook/astryx/commit/0b5a38e9883185156056f9a9639b57d5d980191e)였다.

### 확인 범위와 계약

| 확인 항목 | 관찰 | 판정에 미치는 의미 |
| --- | --- | --- |
| 저장소 파일·문서 검색 | `rg`로 `apps/docsite/src/app/mcp/route.ts`, 해당 route 테스트, `working-with-ai.doc.mjs`를 확인했다. `packages/cli`에는 MCP를 실행하는 별도 패키지·binary가 없다. | MCP는 CLI의 로컬 subprocess가 아니라 docsite가 제공하는 원격 서비스다. |
| 서버 도구 | route는 `search(query, limit?)`와 `get(name, section?)` 두 도구를 등록한다. `search`는 component/doc/template의 축약 결과를, `get`은 컴포넌트·문서 주제·template의 상세 props·예제 등을 반환한다. | Astryx 문서·컴포넌트 탐색에는 충분하지만, Penpot 토큰 변환이나 `theme build`를 수행하는 도구는 아니다. |
| 실제 endpoint | `initialize` JSON-RPC 요청에 HTTP 200을 받았고 `protocolVersion: 2025-06-18`, `serverInfo: { name: "astryx", version: "2.0.0" }`, tools capability를 반환했다. | 코드·문서뿐 아니라 공개 endpoint가 해당 MCP 계약을 제공함을 교차 확인했다. |
| 공식 문서 사이트 | [Astryx 홈페이지](https://astryx.atmeta.com/)와 [One Month of Astryx](https://astryx.atmeta.com/blog/one-month-of-astryx)는 CLI와 MCP 서버를 agent-facing surface로 소개한다. `astryx-canary.vercel.app` 검색에서는 현행 MCP 계약 문서를 찾지 못했고, 현행 공식 도메인 `astryx.atmeta.com`과 저장소를 권위 출처로 사용했다. | 이전의 canary 문서만으로 "독립 MCP 없음"이라 했던 결론은 더 이상 유효하지 않다. |
| npm namespace | `npm search --json @astryxdesign/mcp`와 `npm view @astryxdesign/mcp`를 실행했다. 전자는 `core`, `cli`, `build`, theme 패키지만 반환했고, 후자는 404였다. [공개 CLI 패키지](https://www.npmjs.com/package/@astryxdesign/cli)는 존재한다. | 공식 MCP는 설치할 `@astryxdesign/mcp` 패키지가 아니라 위 원격 endpoint로 제공된다. |

### teguma에 대한 결론

Astryx MCP의 두 읽기 도구는 호출 에이전트가 고정한 Astryx 버전의 컴포넌트·문서·예제를 조회하는 데 사용할 수 있다. 하지만 theme 컴파일 도구는 제공하지 않으므로, POC의 승인된 테마 초안 검증은 소비자 sandbox에서 고정 버전의 `@astryxdesign/cli theme build`로 수행한다. 따라서 **teguma는 Astryx MCP를 내장·프록시하거나 CLI subprocess를 실행하지 않는다.** teguma의 책임은 순수 토큰 변환과 구조화된 누락 보고이며, 개발 에이전트는 필요에 따라 공식 원격 MCP 또는 CLI JSON/manifest/dense를 직접 사용한다. CLI JSON/manifest/dense는 MCP가 닿지 않는 theme build·자동화 검증 및 원격 MCP 장애 시 문서 조회의 대체 경로로 충분하다.

## 4. teguma와의 시너지 평가

teguma는 Penpot 파일에서 압축 브랜드 컨텍스트(`get_design_context`), 토큰(`get_tokens`), 컴포넌트·제약(`get_components`, `get_constraints`), 페이지 레이아웃을 제공하고 선언형 디자인 문서를 QA한다. Astryx는 코드 단계에서 접근성 컴포넌트, semantic theme, 템플릿, agent-readable 문서를 제공한다. 즉 양쪽은 경쟁 관계가 아니라 **디자인 원천 → 토큰/제약 → React UI 조합**의 인접 단계다. teguma의 현 도구 경계는 [MCP 도구 아틀라스](../code-atlas/concepts/mcp-tools.md)에 기록돼 있다.

```text
Penpot 디자인 시스템
  └─ teguma: get_design_context / get_tokens / get_constraints
       └─ (POC) 검토 가능한 Astryx 테마 초안 + 누락·충돌 보고
            └─ 개발 에이전트: 공식 Astryx MCP 또는 CLI(JSON/dense)로 컴포넌트·템플릿 탐색
                 └─ React 19+ 앱에서 Astryx 컴포넌트와 테마 적용
```

| 평가 항목 | 판단 | 근거 |
| --- | --- | --- |
| 토큰 연결 | 높음 | teguma의 색상·타이포·간격 추출과 Astryx의 CSS 변수 테마 모델이 직접 인접 |
| 에이전트 협업 | 높음 | teguma의 압축 컨텍스트와 Astryx CLI의 JSON/manifest/dense 출력이 모두 기계 소비를 고려 |
| 컴포넌트 매핑 | 중간 | Penpot 컴포넌트 이름·변형과 Astryx API는 별개이므로 사람 검토가 필요한 후보 매핑만 가능 |
| 레이아웃/코드 생성 | 중간 이하 | teguma는 캔버스·출고 QA, Astryx는 React UI이므로 픽셀/구조 동등성을 약속하면 안 됨 |
| 운영 안정성 | 보류 | Astryx가 Beta이고 공개 API·테마·CLI가 빠르게 변화하므로 버전 고정과 fixture 검증이 선행돼야 함 |

## 5. 권장 범위와 위험

1. 첫 POC는 Penpot 토큰을 읽어 Astryx `defineTheme` 초안과 매핑 보고를 만드는 **순수 변환**으로 한정한다.
2. 자동 React 코드 생성은 Astryx CLI가 반환한 공식 템플릿·컴포넌트 문서를 근거로 하되, 변환기의 책임에 포함하지 않는다.
3. Astryx 패키지 설치, teguma 런타임 의존성 추가, subprocess 실행, Astryx MCP 프록시 또는 teguma MCP 도구 공개는 모두 이 문서의 범위 밖이며 별도 승인·명세가 필요하다.
4. 컴포넌트 매핑은 이름 유사성만으로 확정하지 않고 접근성 의미·상태·variant를 포함한 검토 표를 남긴다.
5. Beta 변경에 대비해 Astryx 버전과 CLI JSON schema/manifest를 fixture로 고정하고, 업그레이드는 명시적으로 검토한다.

## 출처

- [facebook/astryx 저장소](https://github.com/facebook/astryx) — 패키지 구조, React/StyleX, 라이선스, 설계 원칙
- [@astryxdesign/core README](https://github.com/facebook/astryx/blob/main/packages/core/README.md) — CSS layer, provider, token 예시, CLI 명령
- [Astryx CLI 문서](https://astryx-canary.vercel.app/docs/cli) — JSON API, manifest, dense 출력, 오류 계약
- [Astryx CLI 설계 글](https://astryx-canary.vercel.app/blog/the-astryx-cli) — agent-first 탐색·조합·테마·진단 흐름
- [Astryx MCP route](https://github.com/facebook/astryx/blob/main/apps/docsite/src/app/mcp/route.ts) — Streamable HTTP transport, `search`/`get` 도구 구현
- [Astryx AI 작업 문서](https://github.com/facebook/astryx/blob/main/packages/cli/assets/docs/working-with-ai.doc.mjs) — 원격 MCP endpoint와 클라이언트 설정
- [Astryx 공식 홈페이지](https://astryx.atmeta.com/) — CLI/MCP agent-facing surface 소개

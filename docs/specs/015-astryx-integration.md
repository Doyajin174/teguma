# Astryx 디자인 시스템 연동/활용 명세

> 상태: Proposed — 조사·명세 단계
>
> 작성일: 2026-08-08
>
> 관련 이슈: [#23](https://github.com/Doyajin174/teguma/issues/23)
>
> 선행 조사: [015-astryx-design-system.md](../research/015-astryx-design-system.md)

## 목표

Penpot에서 teguma가 추출한 브랜드 토큰과 레이아웃 제약을, React 19+ 소비 애플리케이션에서 사용할 Astryx 테마·컴포넌트 선택 워크플로로 안전하게 이어 간다. 이 연동은 디자인 원천의 의미를 보존하고, 추측한 토큰이나 컴포넌트 API를 생성하지 않으며, 호출 에이전트가 공식 Astryx CLI 문서를 근거로 코드를 조합하도록 돕는다.

## 비목표

- 이 이슈에서 Astryx 패키지를 설치하거나 teguma 의존성·런타임을 변경하지 않는다.
- Penpot 캔버스와 Astryx React 컴포넌트의 양방향 동기화·픽셀 동등성을 만들지 않는다.
- Astryx CLI를 teguma 서버가 실행하거나, Astryx의 공식 MCP를 프록시하거나, 별도 MCP 서버를 추가하지 않는다.
- React 코드·JSX·CSS를 자동으로 생성하거나 Astryx component 매핑을 자동 확정하지 않는다.
- teguma의 기존 `get_tokens` 응답 계약을 변경하지 않는다.

## 선택한 연동 방식

### 권장: 별도 순수 토큰 변환기 + 에이전트 핸드오프

후속 구현은 teguma 내부의 순수 변환 모듈로 시작한다. 입력은 기존 `get_design_context` 또는 `get_tokens`의 구조화 결과와 명시적 변환 옵션이며, 출력은 다음 세 artefact다.

1. Astryx `defineTheme` 형식의 **초안**(또는 동등한 CSS custom property override 초안)
2. 원천 token → Astryx semantic token의 매핑 표
3. 매핑하지 않은 원천 토큰, 역할 충돌, dark mode 누락, 지원하지 않는 token 종류를 담은 경고 보고

출력은 파일을 쓰거나 패키지를 설치하지 않는다. 소비자가 검토·커밋한 뒤 Astryx의 `theme build`를 실행한다. 이름은 후속 구현 때 정하되, 기존 공개 MCP 도구와 혼동하지 않도록 새 MCP 도구 이름을 이 명세에서 예약하지 않는다.

```text
Penpot
  → teguma get_design_context / get_tokens / get_constraints
  → 순수 Astryx-theme 초안 변환 (POC)
  → 개발자 검토·수정·커밋
  → 소비 React 프로젝트의 astryx theme build
  → 에이전트가 Astryx CLI로 component/template 조회 후 UI 구현
```

### 대안 평가

| 방식 | 판단 | 이유 |
| --- | --- | --- |
| teguma MCP 확장으로 즉시 공개 | 보류 | 입력·출력 schema, 버전, 권한, 오류 계약을 정하지 않은 상태에서 공개 API를 늘릴 수 없음 |
| 순수 토큰 변환기 | 채택 | 기존 토큰 경계를 유지하고 fixture 단위 테스트로 결정론·누락 처리를 검증 가능 |
| Astryx CLI subprocess 호출 | 보류 | CLI 버전 고정, 실행 환경, JSON 계약, 실패 처리의 별도 설계가 필요 |
| JSX/React 코드 생성 | 후속 | Astryx의 component/template 문서를 존중해야 하며 컴포넌트 의미 매핑 검토가 선행돼야 함 |
| Penpot ↔ Astryx 양방향 동기화 | 제외 | 캔버스 디자인과 런타임 UI의 모델·책임이 달라 현 이슈의 단일 책임을 벗어남 |

### 공식 Astryx MCP와의 관계

2026-08-08 검증 결과 Astryx는 공식 원격 MCP 서버(`https://astryx.atmeta.com/mcp`)를 제공한다. 계약은 문서·컴포넌트·template 검색용 `search(query, limit?)` 및 상세 조회용 `get(name, section?)` 두 도구이며, theme build나 Penpot 토큰 변환 도구는 포함하지 않는다. 근거와 endpoint 검증 결과는 [조사 문서의 검증 보강](../research/015-astryx-design-system.md#검증-보강-공식-mcp-서버-계약)을 따른다.

따라서 호출 에이전트는 직접 Astryx MCP를 연결해 컴포넌트·예제를 조회할 수 있지만, teguma는 이를 내장·프록시하지 않는다. `CLI subprocess 호출`을 채택하지 않는다는 결론도 유지한다. 단, POC 검증 담당자는 teguma 밖의 고정 버전 consumer sandbox에서 공식 CLI를 명시적으로 실행해 `theme build`를 검증한다. 이는 teguma 런타임의 subprocess 통합이 아니다.

## 토큰 변환 계약 (POC)

### 입력

- 기존 teguma `get_tokens` 결과의 색상·타이포그래피·spacing 데이터
- 가능하면 `get_design_context`의 브랜드·컴포넌트 메타데이터와 `get_constraints`의 명시적 가드레일
- 선택 옵션: 기준 Astryx theme 이름, light/dark 선택, 사람이 부여한 semantic role override

원천에 role이 없는 색상·수치 토큰은 자동으로 `primary`, `surface`, `error` 등의 semantic 역할을 부여하지 않는다. 사람이 준 override가 없으면 후보 목록과 미매핑 이유를 반환한다.

### 출력

```ts
interface AstryxThemeDraft {
  baseTheme: string;
  light?: Record<string, string>;
  dark?: Record<string, string>;
  typography?: Record<string, string | number>;
  mapping: Array<{
    sourceToken: string;
    astryxToken?: string;
    status: "mapped" | "unmapped" | "conflict";
    rationale: string;
  }>;
  warnings: Array<{
    code: "MISSING_ROLE" | "UNSUPPORTED_TOKEN" | "MISSING_DARK_MODE" | "INVALID_VALUE";
    sourceToken?: string;
    message: string;
  }>;
}
```

이 타입은 구현 확정 전의 POC 계약이다. 실제 `defineTheme` 인자·token key는 고정한 Astryx 버전의 공식 CLI/API 출력으로 검증한 뒤에만 확정한다. 변환기는 임의 CSS나 실행 가능한 명령을 반환하지 않고, 안전한 값과 구조화된 보고만 반환한다.

### 매핑 규칙

| 원천 | 조건 | 출력 |
| --- | --- | --- |
| 색상 | semantic role이 명시됐고 CSS 색 값으로 유효 | 해당 Astryx color override 후보와 `mapped` 기록 |
| 색상 | role 불명 또는 여러 role 충돌 | override 생략, `MISSING_ROLE` 또는 `conflict` 기록 |
| 타이포그래피 | family/weight/size 값이 유효 | typography 후보와 출처 기록; 폰트 다운로드·설치는 하지 않음 |
| spacing | 양수·단조 scale이며 Astryx scale과 대응 가능 | spacing override 후보와 scale 변환 근거 기록 |
| radius/shadow | 원천에 명시적으로 존재 | 지원 key가 확인된 경우만 후보 생성 |
| light/dark | 두 모드가 모두 존재 | light/dark 각각을 분리해 출력 |
| light/dark | 한 모드만 존재 | 존재 모드만 출력하고 `MISSING_DARK_MODE` 경고 |

## 에이전트 워크플로

변환 후 호출 에이전트는 Astryx CLI의 JSON 또는 dense 출력으로 UI를 구성한다. 권장 순서는 다음과 같다.

1. 변환 보고에서 확정 token과 경고를 읽는다.
2. 소비 애플리케이션에서 고정한 Astryx 버전의 `manifest --json`으로 지원 명령을 확인한다.
3. `build`, `search`, `component`, `template`을 사용해 요구와 가까운 공식 예제를 찾는다.
4. 사람이 theme 초안과 컴포넌트 선택을 검토한다.
5. 소비 애플리케이션에서 Astryx의 공식 `theme build`, `doctor`, 접근성·시각 회귀 검사를 실행한다.

teguma는 이 흐름에서 Penpot 원천 컨텍스트와 검토 가능한 변환 결과를 제공한다. Astryx CLI의 설치·실행·코드 작성은 소비 애플리케이션과 그 에이전트의 책임이다.

## POC 계획

### 범위와 입력

이번 이슈의 구현 POC는 **비식별 Penpot 토큰 fixture → Astryx CSS 변수 테마 초안 및 매핑·경고 보고**만 다룬다. 실제 Penpot 파일, 사용자·조직명, URL, 폰트 라이선스 정보, 이미지, 비밀값은 fixture에 넣지 않는다. role이 명시된 색상, light/dark 쌍, typography, 단조 spacing scale과 의도적으로 role 없는 색상·dark 누락 사례를 한 fixture에 포함한다. 대표 React 화면 조합은 POC 완료 조건이 아니며 별도 후속 범위다.

### 버전 고정

Astryx는 Beta이므로 POC를 시작하기 전에 consumer sandbox의 `@astryxdesign/core`와 `@astryxdesign/cli`를 정확히 같은 버전(`0.3.0`으로 시작; 업그레이드는 별도 승인)으로 고정하고 lockfile을 커밋한다. 그 버전의 `astryx manifest --json`, `astryx docs theme --json`, `astryx theme build`의 결과·오류 형식을 POC 증적으로 기록한다. 버전, manifest 또는 build 결과가 달라지면 매핑을 변경하지 말고 POC를 중단해 재검토한다.

### 예상 파일과 단계

| 단계 | 예상 파일 | 산출물 |
| --- | --- | --- |
| 1. 입력 고정 | `test/fixtures/astryx-penpot-tokens.json` | 비식별 `get_tokens` 형태 fixture와 명시적 semantic role override 사례 |
| 2. 순수 변환 | `src/design/astryx-theme.ts` | `AstryxThemeDraft` 초안, stable mapping/warning 정렬, 추측하지 않는 누락 처리 |
| 3. 단위 검증 | `test/astryx-theme.test.ts` | mapped/unmapped/conflict, dark 누락, invalid value, 결정론 순서를 검증하는 테스트 1개 이상 |
| 4. consumer 검증 | `test/fixtures/astryx-theme-poc/` (독립 sandbox 또는 동등한 fixture 경로) | 고정 `package.json`·lockfile·승인된 theme 입력과 `theme build` 실행 기록 |
| 5. 결과 기록 | `docs/research/015-astryx-design-system.md` 또는 후속 POC 보고 | 고정 버전, build 명령·결과, 수동 결정, 미매핑 토큰 |

단계 2의 모듈은 기존 `get_tokens` 결과를 입력으로 받을 뿐 MCP 서버에 등록하지 않는다. 단계 4의 CLI 실행은 consumer sandbox에서만 수행하며, teguma dependency나 런타임 subprocess를 추가하지 않는다.

### 완료 기준과 검증

- 동일 fixture를 두 번 변환해 mapping·warning 배열이 바이트 단위로 동일함을 단위 테스트로 증명한다.
- role 없는 색상과 단일 모드 입력이 각각 `MISSING_ROLE`, `MISSING_DARK_MODE` 구조화 경고를 내고 임의 semantic token을 만들지 않음을 검증한다.
- 사람이 승인한 fixture의 theme 입력이 고정된 `@astryxdesign/cli` 버전에서 `astryx theme build <input> --out <output>`로 exit code 0을 반환하고 output CSS가 생성됨을 검증한다.
- `npm test` 전체가 통과하고 기존 `get_tokens` 응답 계약·teguma 의존성·MCP 도구 등록에 변경이 없음을 확인한다.

### 명세 재점검 (2026-08-08)

| 점검 항목 | 결과 | 반영 |
| --- | --- | --- |
| 이슈 #23 완료 시나리오 | Penpot 토큰 조회에서 Astryx 테마 초안·색상/타이포/간격 매핑·누락 보고가 재현 가능해야 한다. | POC 입력, 산출물, `theme build` 성공 기준을 측정 가능하게 명시했다. 실제 POC 코드·테스트는 아직 미완료다. |
| 측정 가능성 | 기존 "POC 방향"은 fixture 내용·예상 파일·명령 성공 조건이 충분히 구체적이지 않았다. | 비식별 fixture, 예상 파일, 고정 버전, stable output, exit code 0/CSS 생성, 전체 회귀를 완료 기준으로 추가했다. |
| 누락·모순 | 기존 대표 React 화면 조합은 이슈의 토큰 변환 완료 시나리오보다 넓고, `theme build` 실행 주체도 분명하지 않았다. | 화면 조합을 후속 범위로 분리하고, build는 teguma 밖 consumer sandbox의 명시적 검증으로 한정했다. |
| MCP/CLI 결론 | 이전 조사의 "공식 독립 MCP 미확인"은 현행 저장소·endpoint와 모순됐다. CLI subprocess 채택 보류와도 구분이 필요했다. | 공식 MCP의 존재·두 도구 계약을 반영했다. remote MCP 직접 사용은 허용하되 teguma의 MCP 프록시·CLI subprocess 통합은 계속 비목표로 유지한다. |

## 완료 조건

- [x] Astryx 저장소 구조, 토큰/테마, CLI·agent workflow, 공식 MCP 계약, teguma 시너지 조사를 문서화한다.
- [x] 이 연동 명세에서 목표·비목표·방식 선택·측정 가능한 POC 계획을 확정한다.
- [ ] POC 시작 시 `@astryxdesign/core`·CLI 고정 버전과 비식별 fixture를 선정·커밋한다.
- [ ] 순수 토큰 변환 POC와 단위 테스트를 구현한다.
- [ ] 고정 Astryx 버전의 `theme build` 및 대표 React sandbox 검증을 기록한다.
- [ ] POC 결과를 바탕으로 MCP 공개 여부와 코드 생성 범위를 별도 결정한다.

## 위험과 중단 기준

- Astryx의 Beta API, token key, CLI JSON schema가 고정 버전과 다르면 POC를 중단하고 fixture·매핑을 갱신할지 별도 결정한다.
- 원천 토큰에 semantic role, dark mode, 라이선스 가능한 폰트 정보가 없으면 자동 보완하지 않고 경고와 사람 검토로 남긴다.
- CLI 실행에 네트워크, 패키지 설치, 임의 파일 쓰기 또는 별도 인증이 필요하면 이 명세의 순수 변환 범위를 넘으므로 새 권한·설계 승인 없이는 진행하지 않는다.

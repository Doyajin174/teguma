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
- Astryx CLI를 teguma 서버가 실행하거나, 별도 MCP 서버를 추가·프록시하지 않는다.
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

## POC 방향

### 선행 조건

- 조사 당시 Astryx는 Beta이므로 POC 시작 시 `@astryxdesign/core`·CLI 버전을 하나로 고정한다.
- 고정 버전의 `docs tokens`, `docs theme`, `manifest --json`, `theme build` 결과를 fixture로 보관할 승인 범위를 별도 이슈에서 정한다.
- 대표 Penpot 파일 1개와 light/dark·역할 기반 색상·타이포·spacing을 포함한 비식별 fixture를 선정한다.

### POC 시나리오

1. fixture에서 `get_tokens`와 `get_constraints`를 호출한다.
2. 순수 변환기를 실행해 `AstryxThemeDraft`와 경고 보고를 얻는다.
3. 사람이 semantic role 매핑을 검토하고, 고정 Astryx 버전에서 유효한 theme 초안인지 `theme build`로 확인한다.
4. `build` 또는 `template` 결과를 사용해 하나의 대표 화면을 별도 React 19+ sandbox에서 조합한다.
5. 토큰 원천, 생성 theme, 선택 컴포넌트, 남은 수동 결정을 표로 비교한다.

### POC 성공 기준

- 입력이 동일하면 변환 결과의 매핑 순서·경고 순서가 결정론적으로 동일하다.
- 변환기는 role 없는 색상과 불완전한 dark mode를 임의 보정하지 않고 구조화된 경고로 남긴다.
- 사람이 승인한 theme 초안이 고정 Astryx 버전의 공식 빌드에서 성공한다.
- 대표 화면이 Astryx 공식 컴포넌트·템플릿을 사용하며, teguma 원천 토큰과 다른 값은 명시적으로 문서화한다.
- teguma의 기존 MCP 도구 계약·런타임 의존성·Penpot 쓰기 동작은 변하지 않는다.

## 완료 조건

- [x] Astryx 저장소 구조, 토큰/테마, CLI·agent workflow, teguma 시너지 조사를 문서화한다.
- [x] 이 연동 명세에서 목표·비목표·방식 선택·POC 방향을 확정한다.
- [ ] 별도 승인 이슈에서 Astryx 고정 버전과 POC fixture를 선정한다.
- [ ] 순수 토큰 변환 POC와 단위 테스트를 구현한다.
- [ ] 고정 Astryx 버전의 `theme build` 및 대표 React sandbox 검증을 기록한다.
- [ ] POC 결과를 바탕으로 MCP 공개 여부와 코드 생성 범위를 별도 결정한다.

## 위험과 중단 기준

- Astryx의 Beta API, token key, CLI JSON schema가 고정 버전과 다르면 POC를 중단하고 fixture·매핑을 갱신할지 별도 결정한다.
- 원천 토큰에 semantic role, dark mode, 라이선스 가능한 폰트 정보가 없으면 자동 보완하지 않고 경고와 사람 검토로 남긴다.
- CLI 실행에 네트워크, 패키지 설치, 임의 파일 쓰기 또는 별도 인증이 필요하면 이 명세의 순수 변환 범위를 넘으므로 새 권한·설계 승인 없이는 진행하지 않는다.

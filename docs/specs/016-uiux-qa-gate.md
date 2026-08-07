# UI/UX Pro Max 기반 디자인 QA 게이트 명세

> 상태: Proposed — POC 미구현
> 작성일: 2026-08-08
> 관련 이슈: [#24](https://github.com/Doyajin174/teguma/issues/24)

## 목표

teguma MCP로 생성한 `DesignDocument`의 QA 결과에 UI/UX Pro Max 지식에 근거한 색상·타이포그래피 점검을 독립 항목으로 추가한다. 결과는 예를 들어 `색상 대비 부족(2건)`, `타이포 스케일 이탈(1건)`, `UX 가이드라인 위반(0건)`처럼 개수와 대상 레이어를 재현 가능하게 보여야 한다.

## 범위와 비범위

POC는 `src/design/qa.ts`와 현재 선언형 `DesignDocument`만 대상으로 한다.

- 포함: 선택 프로필의 역할 색상 쌍, 폰트 조합, 타입 스케일, 본문 최소 크기·행간의 결정적 검사
- 포함: 기존 `QaReport.checks`에 이름·통과 여부·대상 레이어를 담는 결과
- 제외: 이미지 픽셀에서 색을 추출하는 검사, VLM/미적 점수, 자동 수정·정규화, 새 MCP 도구·외부 API·의존성, 웹 에디터의 상호작용/ARIA 검사
- 제외: 스킬 경로를 프로덕션에서 읽거나 Python CLI를 매 요청 실행하는 방식

## 근거와 우선순위

현재 `qa.ts`의 `text-contrast-at-least-4.5`는 배경 합성과 불확실 배경 fail-closed까지 처리하므로 그대로 단일 대비 판정원으로 유지한다. UI/UX Pro Max의 `colors.csv`는 역할 색상 팔레트, `typography.csv`는 글꼴 조합, `quick-reference.md`는 본문 16px·행간 1.5–1.75·일관된 타입 스케일을 제공한다.

브랜드 키트가 문서에 있으면 브랜드 키트가 색상·폰트의 허용 목록에서 우선한다. 스킬 프로필은 추천/검사 기준일 뿐 고객 브랜드를 덮어쓰지 않는다.

## 데이터 매핑

| 스킬 지식 | `DesignDocument` 입력 | POC 판정 | 결과 체크 이름 |
|---|---|---|---|
| `colors.csv`의 `Background`/`Foreground`, `Primary`/`On Primary`, `Accent`/`On Accent`, `Card`/`Card Foreground`, `Destructive`/`On Destructive` | `page.background`, `rect.fill`, `text.color`; 텍스트의 아래 rect 또는 페이지 배경 | 기존 대비 알고리즘으로 각 실제 전경/배경 조합의 최악 대비를 판정. 4.5:1 미만 대상은 실패 | 기존 `text-contrast-at-least-4.5` |
| 같은 팔레트의 역할 색상 | 위 색상 필드와 활성 브랜드 키트 | 프로필/브랜드 키트에 선언되지 않은 색상은 대상별로 보고. 수치 색상 거리나 임의의 조화 점수는 사용하지 않음 | `uiux-palette-role-consistency` |
| `typography.csv`의 `Heading Font`, `Body Font` | 텍스트의 `fontFamily`, `fontWeight` | 헤딩/본문으로 지정된 레이어가 허용 글꼴·굵기를 쓰는지 검사. 역할 판별 메타데이터가 아직 없으므로 POC는 문서/템플릿이 명시한 역할만 검사하고, 역할이 없으면 `not-applicable`로 보고 | `uiux-font-pairing` |
| `quick-reference.md`의 예시 스케일 `12/14/16/18/24/32`, 본문 16px, 행간 1.5–1.75 | 텍스트의 `fontSize`, `lineHeight` | 역할이 `body`인 레이어는 16px 이상·행간 범위인지, 모든 역할 지정 텍스트는 선택 스케일 중 하나인지 검사 | `uiux-type-scale` |
| `ux-guidelines.csv`의 `Color Contrast`, `Contrast Readability`, `Typography` 규칙 | 위 판정 결과 | POC에서 구현한 UX 규칙의 실패 개수를 집계. 레이어 모델에 없는 키보드/ARIA/상태 규칙은 검사하지 않음 | `uiux-guideline-violations` |

`colors.csv` 자체에는 "색상 조화"의 공식이나 점수가 없으므로, `uiux-palette-role-consistency`는 **선택 팔레트와의 일관성**을 의미한다. 조화 점수로 이름 붙이거나 통과 기준을 만들지 않는다.

## POC 계획

### 고정 프로필과 입력

POC는 한 프로필만 사용한다. 이름은 `micro-saas-korean`으로 고정하고, [조사 문서](../research/016-uiux-pro-max-integration.md#검증-보강)에 인용한 `colors.csv`의 `Micro SaaS` 행, `typography.csv`의 `Korean Modern` 행, `ux-guidelines.csv` No. 36·72·74를 출처로 한다. 즉 팔레트는 `#F5F3FF/#1E1B4B`, `#6366F1/#FFFFFF`, `#059669/#FFFFFF` 역할 쌍을, 글꼴은 헤딩·본문 모두 `Noto Sans KR`을, 타입 스케일은 `12/14/16/18/24/32`와 본문 16px 이상·행간 1.5–1.75를 사용한다.

현재 `DesignDocument`의 텍스트 레이어에는 heading/body 역할 필드가 없고 `inspectDocument(document, policy?)`의 두 번째 인수는 workspace policy다. 따라서 이 POC는 공개 스키마·MCP API를 바꾸지 않는다. 후속 구현 이슈에서 승인된 방식으로 역할을 전달하기 전까지, POC의 역할 기대값은 테스트 fixture와 `qa.ts` 내부의 비공개 고정 프로필 입력으로만 둔다. 역할 없는 일반 문서는 새 검사 결과를 추가하지 않아 기존 `QaReport` 모양과 통과 여부를 보존한다.

### 구현 단계

1. `qa.ts`에 위 고정 프로필의 역할 쌍을 표현하는 작은 상수와, profile-enabled POC 입력에서만 동작하는 검사를 추가한다. 스킬 CSV를 읽거나 검색 CLI를 호출하지 않는다.
2. 페이지 배경/텍스트, primary rect/on-primary text, accent rect/on-accent text가 지정된 역할 쌍인지 `uiux-palette-role-consistency`로 검사한다. 실제 대비의 판정은 새 계산으로 복제하지 않고 기존 `text-contrast-at-least-4.5` 결과를 그대로 사용한다.
3. 역할이 지정된 헤딩·본문의 `fontFamily`를 `Noto Sans KR`과 비교해 `uiux-font-pairing`으로, `fontSize`·본문 `lineHeight`를 고정 스케일·범위와 비교해 `uiux-type-scale`로 보고한다.
4. UX 집계 `uiux-guideline-violations`는 기존 대비 결과와 타입 규칙 결과를 참조해 종류별 수를 요약한다. 같은 대비 실패를 출고 실패로 중복 계상하지 않는다.

### 재현 fixture와 기대 결과

단일 fixture는 profile-enabled 문서에 다음 레이어를 둔다. 각 detail은 `pageId/layerId`, 실제 값, 기대 역할 또는 임계값을 포함하고, 체크 순서도 고정한다.

| 입력 레이어 | 고정 입력 | 기대 결과 |
|---|---|---|
| `bad-contrast-1` | 알려진 배경 위의 텍스트가 4.5:1 미만 | 기존 대비 detail에 이 레이어 1건, UX 대비 집계 1건 |
| `bad-contrast-2` | 다른 알려진 배경 위의 텍스트가 4.5:1 미만 | 기존 대비 detail에 이 레이어 1건, UX 대비 집계 누계 2건 |
| `body-off-scale` | body 역할, `Noto Sans KR`, 15px 또는 행간 1.3 | `uiux-type-scale` detail에 타입 스케일 위반 1건 |
| `profile-palette-off` | 역할 쌍에 없는 rect 또는 text 색상 | `uiux-palette-role-consistency` detail에 레이어·실제 색상·기대 역할 |
| `compliant-body` | `Noto Sans KR`, 16px, 행간 1.5, 대응 역할 쌍에서 4.5:1 이상 | 새 검사와 기존 대비 검사 모두 통과 |

테스트는 (1) 이 fixture가 **대비 2건**, **타입 스케일 1건**, 팔레트 역할 위반을 각각 분리해 보고하는지, (2) 프로필 없는 기존 fixture의 `QaReport`가 변하지 않는지, (3) 불확실 이미지·둥근 배경의 기존 fail-closed 대비 회귀가 유지되는지를 검증한다.

### POC 완료 기준

- 고정 프로필의 모든 값이 조사 문서의 실제 CSV 행·규칙 번호로 추적된다.
- `qa.ts`는 대비 위반 2건과 타입 스케일 위반 1건을 별도 체크/detail 또는 결정적 집계로 반환하며, 각 대상 레이어를 식별한다.
- 팔레트 역할, 폰트 조합, 타입 스케일의 세 검사가 고정 fixture에서 재현되고, 프로필 없는 기존 문서 결과는 변하지 않는다.
- POC 테스트 1개 이상, 기존 QA 회귀 테스트, `npm test`가 통과한다. 새 의존성·네트워크 호출·스킬 DB 변경은 없다.

### 명세 재점검 결과

| 점검 | 결과 | 명세 반영 |
|---|---|---|
| 이슈 #24 완료 시나리오 | 일치 | 위 fixture가 QA 결과에서 대비 2건·타입 스케일 1건·UX 집계를 재현하도록 고정했다. 실제 POC 구현과 전체 테스트·PR/리뷰/머지는 이 문서 작업의 후속 완료 조건으로 남는다. |
| 측정 가능한 완료 조건 | 보강 필요 → 보강 완료 | 체크 이름, 대상 레이어, 기대값/임계값, 고정 개수와 회귀 범위를 완료 기준에 명시했다. |
| 주관적 조화 점수 제외 | 일치 | `colors.csv`에는 조화 공식·점수가 없고 현 `DesignDocument`에는 결정적으로 비교 가능한 색상 필드만 있으므로, 역할 쌍 일관성만 검사한다. |
| POC 범위 | 적정 (경계 명시) | 현 모델에는 역할 메타데이터가 없으므로 POC는 비공개 fixture 입력에 한정한다. 공개 스키마/API 결정, 이미지/VLM 미감 평가, 자동 수정은 후속 권한 없이는 추가하지 않는다. |

## POC 실행 계약

1. 구현 시 색상·폰트·타입 스케일 프로필은 저장소 안의 작고 버전 고정된 입력으로 둔다. 스킬 전체 CSV와 Python 검색기를 런타임 의존성으로 추가하지 않는다.
2. `inspectDocument`는 프로필 없는 기존 호출자의 보고서 모양과 통과 여부를 보존한다. 이 POC에서는 프로필 없는 경우 새 검사를 보고서에 넣지 않으며, 그 동작을 회귀 테스트로 고정한다.
3. 프로필이 선택된 경우 모든 새 위반은 `pageId/layerId`, 규칙/역할, 실제 값, 기대 값 또는 임계값을 포함한다. 세부 정보는 사람이 수정할 수 있는 문장으로 만든다.
4. 기존 대비 체크와 새 집계 체크가 같은 실패를 두 번 출고 실패로 세지 않는다. 기존 대비는 판정원, UX 집계는 그 결과를 참조하는 요약이다.
5. 활성 브랜드 키트와 선택 프로필이 충돌하면 `brand-kit-respected` 실패를 유지하고, 프로필은 자동 변경하지 않는다.

## 최소 재현 시나리오

POC 테스트는 고정 프로필 하나와 다음 한 문서를 만들어 `inspectDocument` 결과를 검증한다.

| 레이어 | 입력 | 기대 결과 |
|---|---|---|
| `bad-contrast-1`, `bad-contrast-2` | 서로 다른 알려진 배경 위의 텍스트 2개가 각각 4.5:1 미만 | `text-contrast-at-least-4.5` 실패 detail에 두 대상, UX 집계는 대비 위반 2건 |
| `body-off-scale` | `body` 역할, 15px 또는 행간 1.3 | `uiux-type-scale` 실패 detail에 1건 |
| `profile-palette-off` | 활성 프로필/브랜드 키트에 없는 rect 또는 text 색상 | `uiux-palette-role-consistency` 실패 detail에 대상·실제 색상 |
| `compliant-body` | 프로필 본문 글꼴, 16px, 행간 1.5, 4.5:1 이상 | 새 검사와 기존 대비 검사 모두 통과 |

동일 입력은 항상 같은 체크 이름, 순서, detail을 반환해야 한다. 이미지 배경·둥근 배경처럼 기존 엔진이 불확실하다고 처리하는 경우에는 기존 fail-closed 대비 결과를 그대로 사용한다.

## 완료 조건

- [ ] POC의 고정 프로필이 스킬의 원본 행/규칙과 출처를 주석 또는 문서로 추적한다.
- [ ] `qa.ts`가 기존 대비 판정을 재사용하고 위 재현 시나리오의 두 대비 실패와 한 타입 스케일 실패를 분리해 반환한다.
- [ ] 새 검사마다 대상 레이어와 고칠 수 있는 기대값/임계값이 결과에 있다.
- [ ] 프로필 없는 기존 문서의 QA 회귀 테스트가 통과한다.
- [ ] POC 테스트 1개 이상과 `npm test` 전체가 통과한다.
- [ ] 새 의존성, 외부 네트워크 호출, 스킬 DB 수정이 없다.

## 구현 순서

1. 고정 프로필과 역할 지정 방법을 현재 문서/템플릿 모델에 최소 변경으로 결정한다.
2. `qa.ts`에 프로필 기반 검사와 구조화된 위반 detail을 추가한다.
3. 위 최소 재현 시나리오와 기존 QA 회귀를 실행한다.
4. 렌더/내보내기 경로가 동일한 `QaReport`를 소비하는지 확인한다.

이 명세는 POC 방향만 고정한다. 역할 메타데이터를 문서 스키마의 공개 필드로 만들지, 템플릿 내부 정보로 둘지는 현재 API/스키마 변경 권한이 필요한 후속 구현 이슈에서 결정한다.

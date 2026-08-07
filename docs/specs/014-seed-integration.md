# SEED 디자인 시스템 연동 명세

> 상태: Proposed
>
> 작성일: 2026-08-08
>
> 관련 이슈: [#22](https://github.com/Doyajin174/teguma/issues/22)
>
> 선행 조사: [014-seed-design-system.md](../research/014-seed-design-system.md)

## 목표

SEED rootage의 색상·타이포그래피·간격 토큰을 결정론적으로 해석하여 teguma가 사용할 수 있는 브랜드 키트와 문서 생성 입력으로 변환한다. 변환 결과로 만든 `DesignDocument`는 기존 브랜드 키트 정규화와 QA 게이트를 통과할 수 있어야 한다.

이 명세는 **토큰 임포트 POC의 계약**만 정한다. SEED React 컴포넌트 설치·렌더링, qvism 실행, Figma 파일 쓰기, 양방향 동기화, `BrandKit`/`DesignDocument` 공개 스키마 확장은 범위에 포함하지 않는다.

## 변환 파이프라인

```text
SEED rootage YAML 또는 확정 생성 vars 스냅샷
  → 입력 검증·mode 선택
  → 토큰 참조 해석·단위 정규화
  → SEED token manifest (원본 경로·해석 값·미지원 목록)
  ├→ BrandKit { palette, fonts, logos: [] }
  └→ 문서 생성 입력 { typography scale, spacing scale }
       → DesignDocument 생성
       → applyBrandKit / inspectDocument
```

### 입력

- POC 입력은 라이선스와 출처가 확인된 SEED rootage YAML의 작은 고정 fixture 또는 그 fixture로 생성된 vars 스냅샷이다.
- `mode`는 필수다. 색상은 `theme-light` 또는 `theme-dark`, 일반 토큰은 `default`를 명시한다. 호출자가 mode를 생략하거나 해당 값이 없으면 실패한다.
- 변환기는 YAML 전체를 임의 실행하지 않고 `kind: Tokens`, `data.collection`, `data.tokens`, token `values` 구조만 읽는다.
- 토큰 참조는 `$`로 시작하는 완전 경로만 허용한다. 없는 참조, 순환 참조, 잘못된 값 형식은 실패한다.

### 정규화

- 색상은 해석 후 `#RRGGBB`만 허용한다.
- px 길이는 유한한 양수 또는 0의 수치로 변환한다. `rem`은 POC가 입력에 명시한 root font-size를 기준으로 px로 환산한다.
- 글꼴 굵기는 100–900 정수만 허용한다. 글꼴 family가 없는 토큰은 등록하지 않는다.
- 원본 token path, collection, mode, 해석 전 값과 해석 후 값, 단위 변환 기준은 manifest에 남긴다. manifest는 QA가 소비하는 `DesignDocument`와 분리해 기존 스키마를 바꾸지 않는다.
- radius, shadow, gradient, duration, recipe, component schema 및 지원하지 않는 단위는 `unsupported` 목록에 기록한다. 이 항목들은 조용히 버리거나 근사하지 않는다.

## 브랜드 키트 매핑

| SEED 토큰 범주 | 변환 결과 | 현재 teguma 사용처 | POC 판정 |
| --- | --- | --- | --- |
| `$color.*` | `BrandKit.palette[]`의 `{ id, name, value }` | 색상 정규화, `brand-kit-respected`, 정책 색상 검사 | 지원 |
| font family + `$font-weight.*` | `BrandKit.fonts[]`의 `{ family, weights }` | 텍스트 폰트·굵기 정규화와 위반 검출 | 지원; 글꼴 파일은 별도 제공 |
| `$font-size.*`, `$line-height.*`, letter spacing | typography scale 입력 | `TextLayer.fontSize`, `lineHeight`, `letterSpacing` 생성 | 지원; `BrandKit`에는 저장하지 않음 |
| `$dimension.*`, `$dimension.spacing-*` | spacing scale 입력 | 템플릿 frame, gap, safe margin 계산 | 지원; 값만 적용 |
| 아이콘/로고 자산 | 없음 | `BrandKit.logos[]` | POC 제외; 별도 승인 후 다룸 |
| semantic role, theme 쌍 | manifest provenance | POC 결과 보고 | 현재 `BrandKit` 계약상 두 theme를 동시에 보존하지 않음 |

`BrandKit.id`는 source와 mode를 포함한 안정 식별자(예: `seed-light`)로 만들고, palette 항목 id는 `$`를 제외한 토큰 경로를 teguma 식별자 규칙에 맞게 정규화한다. 충돌하면 원본 token path를 포함한 오류를 반환한다. SEED의 당근 브랜드 로고·자산은 임포트하지 않는다.

## Figma 연동 경계

SEED Figma MCP의 REST API(PAT)와 플러그인/WebSocket 경로는 POC에서 선택 레이어의 코드 생성 결과를 확인하는 데만 쓴다. teguma는 다음을 준수한다.

- PAT·Figma file key·WebSocket 주소를 코드, fixture, git 설정, 문서에 기록하지 않는다.
- 인증 값은 실행 시 환경변수에서만 받고, 로그·오류 메시지에서 마스킹한다.
- Figma는 read-only 입력이며, 변환기는 Figma 파일·변수·컴포넌트를 생성·수정·게시하지 않는다.
- Figma 접속 없이도 고정 rootage fixture로 변환과 QA 회귀 테스트를 재현할 수 있어야 한다.

## POC 완료 조건

- [ ] 작은 rootage YAML fixture에서 `theme-light` 색상, 기본 타이포그래피, dimension 참조를 해석한다.
- [ ] 해석 결과가 `BrandKitSchema`과 `DesignDocumentSchema`을 통과하고, 대표 문서의 `inspectDocument` 브랜드 키트 검사가 통과한다.
- [ ] mode 부재, 없는 참조, 순환 참조, 지원하지 않는 값/단위의 실패 또는 `unsupported` 보고를 테스트한다.
- [ ] 같은 fixture와 mode에서 동일한 manifest·BrandKit·문서 입력을 생성하는 회귀 테스트를 둔다.
- [ ] Figma MCP를 사용할 경우 비밀 값 미기록과 read-only 동작을 수동 점검한다. PAT가 없으면 이 항목은 WebSocket 또는 fixture 기반 검증으로 대체하며, POC 자체의 차단 사유가 아니다.
- [ ] POC 결과(지원 토큰 수, 미지원 종류, 대표 산출물)를 이 이슈 또는 후속 PR에 기록한다.

## 검증 계획

구현 PR은 토큰 파서 단위 테스트와 `BrandKit`/`DesignDocument` 통합 회귀 테스트를 함께 실행한다. 최소 회귀 경로는 다음과 같다.

1. fixture의 `$dimension.spacing-x.global-gutter → $dimension.x4 → 16px` 같은 다단 참조를 해석한다.
2. 선택한 color mode의 hex가 `BrandKit.palette`에 등록되고, 같은 색을 쓰는 문서가 브랜드 위반 없이 QA를 통과하는지 확인한다.
3. 지원하지 않는 토큰과 malformed 입력이 기존 문서를 변경하지 않고 결정론적으로 실패·보고되는지 확인한다.

## 후속 결정 필요 사항

- light/dark 동시 테마와 semantic role을 `BrandKit`의 영속 계약으로 올릴지
- typography·spacing token 이름을 `DesignDocument`에 보존할지
- SEED rootage YAML을 런타임 의존성, 빌드 시 vendored fixture, 생성된 vars 중 어느 형태로 공급할지
- SEED 컴포넌트 schema/recipe 또는 Figma 컴포넌트까지 확장할지

위 항목은 현재 계약·공개 API·의존성 선택을 바꿀 수 있으므로, POC 관측 결과를 바탕으로 별도 이슈에서 결정한다.

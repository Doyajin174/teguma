# 당근 SEED 디자인 시스템 조사

> 조사일: 2026-08-08
>
> 관련 이슈: [#22](https://github.com/Doyajin174/teguma/issues/22)

## 결론

SEED의 공개 `rootage` 프리셋은 YAML 토큰 원본을 플랫폼별 산출물로 변환하는 구조다. teguma는 이 원본을 직접 실행하거나 SEED React 컴포넌트를 가져오는 대신, **해석된 토큰 스냅샷을 `BrandKit`과 문서 생성 제약으로 변환**하는 것이 현재 설계와 맞는다. 색상과 글꼴은 현행 `BrandKit`에 바로 투영할 수 있고, 타이포 크기·행간·간격은 `DesignDocument`의 레이어와 레이아웃 입력에 적용할 별도 변환 결과로 유지해야 한다.

SEED Figma MCP는 Figma 레이어를 React 코드로 읽어 오는 개발 보조 경로다. 토큰 임포트의 정본(source of truth)으로 삼기보다, POC에서 동일 Figma 선택 항목의 코드 생성·토큰 결과를 대조하는 검증 보조 수단으로 사용한다.

## SEED 저장소와 생성 경로

SEED는 토큰·컴포넌트·모션을 여러 플랫폼에서 공유하는 통합 디자인 언어다. 공개 저장소는 다음 계층을 명시한다.

```
rootage YAML (토큰·컴포넌트 스키마)
        ↓
qvism-preset (스타일 recipe)
        ↓
css (토큰·테마·컴포넌트 CSS)
        ↓
react / iOS / Android / Lynx 소비자
```

- `@seed-design/rootage`: 디자인 토큰과 컴포넌트 스키마 정의. `color.yaml`, `font-size.yaml`, `dimension.yaml` 등 foundation 파일과 `components/`를 포함한다.
- `@seed-design/qvism-preset`: rootage를 입력으로 하는 스타일 recipe 정의다.
- `@seed-design/css`: 생성된 토큰, 컴포넌트 스타일, 테마 CSS를 제공한다.
- `@seed-design/react`: 스타일이 적용된 React 컴포넌트다. 이 밖에 iOS·Android enum 및 Lynx용 산출 경로도 있다.
- `ecosystem/rootage`, `ecosystem/qvism`, `ecosystem/figma-extractor`: 각각 토큰 빌드, recipe 빌드, Figma 변수 추출 역할을 맡는다.

`@seed-design/rootage` README는 이 프리셋으로 `qvism-preset/token.css`, `css/vars`와 iOS Swift·Android Kotlin enum을 생성할 수 있다고 명시한다. 따라서 teguma의 입력 후보는 최종 CSS 파싱보다 rootage YAML 또는 rootage가 확정적으로 생성한 vars여야 이름·참조·테마 정보를 보존한다.

## rootage 토큰 형식

토큰 파일은 YAML이며 공통적으로 `kind`, `metadata`, `data.collection`, `data.tokens`를 쓴다. 각 토큰 키는 `$`로 시작하고, 값은 mode 이름별 `values` 맵에 둔다.

```yaml
kind: Tokens
metadata:
  id: dimension
  name: Dimension
data:
  collection: global
  tokens:
    $dimension.x2:
      values:
        default: 8px
    $dimension.spacing-x.global-gutter:
      values:
        default: $dimension.x4
```

색상은 `collection: color`와 `theme-light`·`theme-dark` mode를 사용한다. 예를 들어 `$color.palette.carrot-600`은 각 mode에 hex 값을 갖는다. 글꼴 크기는 `$font-size.t1` 같은 이름에 `rem` 또는 `px` 값을, 간격은 `$dimension.x*`와 의미 이름의 `$dimension.spacing-x.*`, `$dimension.spacing-y.*`에 `px` 또는 다른 토큰 참조를 둔다. 그러므로 변환기는 다음을 수행해야 한다.

1. 파일별 `tokens`를 읽고, 선택한 mode(`theme-light`/`theme-dark` 또는 `default`)를 결정한다.
2. `$…` 참조를 순환 없이 재귀 해석하고 원래 토큰 경로도 보존한다.
3. 색상은 `#RRGGBB`, 길이는 px, `rem` 글꼴 크기는 기준 root font-size와 함께 명시적으로 px로 정규화한다.
4. 알 수 없는 단위·복합 값·순환 참조·선택 mode 부재는 임의 대체하지 않고 변환 오류로 보고한다.

## Figma 연동 방식

SEED는 Figma 라이브러리에 토큰·아이콘·컴포넌트·화면 템플릿을 제공하며, Figma 디자인을 React 코드로 변환하기 위한 MCP를 제공한다. 현재 문서는 두 전송 방식을 구분한다.

- **REST API 방식**: Figma Personal Access Token(PAT)을 환경변수로 제공하고 Figma 레이어 URL을 MCP에 전달한다. 이 방식은 파일 접근 권한이 필요하다.
- **WebSocket 방식**: PAT 없이 로컬 socket 서버와 SEED Figma MCP 플러그인을 연결한 뒤, Figma에서 선택한 레이어를 실시간으로 가져온다.

SEED 저장소의 `packages/figma/figma-extractor.config.ts`는 Figma foundations·components·templates 파일 키를 환경변수로 받으며, Figma API에서 컴포넌트·컴포넌트 세트를 읽어 생성물을 작성한다. 이는 SEED 운영용 추출 파이프라인이고, teguma POC는 비공개 파일 키나 PAT를 저장소·fixture·문서에 넣지 않는다. 인증 값은 실행 환경에서만 주입한다.

## teguma 변환 가능성

현재 teguma의 `BrandKit`은 `palette[]`, `fonts[]`, `logos[]`만 직접 보유한다. `DesignDocument`의 텍스트 레이어는 글꼴 가족·크기·굵기·색상·행간·자간을, 레이아웃은 숫자 좌표와 프레임을 사용한다. 따라서 원자 토큰을 다음처럼 나누어 변환할 수 있다.

| SEED 입력 | teguma 대상 | 처리 | 제약 |
| --- | --- | --- | --- |
| 색상 palette·semantic token | `BrandKit.palette[]` 및 페이지/레이어 색상 | 선택 theme를 해석한 hex를 등록하고 원본 경로를 변환 메타데이터에 보존 | 현재 `BrandKit`은 light/dark 동시 표현과 semantic role 필드가 없음 |
| font family·weight | `BrandKit.fonts[]`, `TextLayer.fontFamily/fontWeight` | family별 허용 weight를 등록 | 실제 폰트 파일 등록은 별도 글꼴 공급 경로가 필요 |
| font-size·line-height·letter-spacing | `TextLayer` 수치 | `rem`/`px`를 px 수치로 해석해 문서 생성 시 적용 | `BrandKit` 스키마에는 type scale이 없으므로 키트 자체에는 넣지 않음 |
| dimension/spacing | 레이아웃·템플릿의 frame, gap, safe margin | px로 해석한 scale에서 선택 | `DesignDocument`에 spacing token 참조 필드가 없어 결과 값만 적용 |
| radius·shadow·gradient·duration·recipe·component schema | 범위 밖 | 원본 경로와 미지원 사유를 보고 | 현행 레이어 모델과 `BrandKit` 계약이 표현하지 않음 |

이 방식은 SEED 토큰으로 만든 teguma 문서가 현행 QA의 브랜드 색상·글꼴 검사와 호환되게 한다. 다만 완전한 양방향 동기화나 SEED 컴포넌트 렌더링을 뜻하지 않는다. dark theme, 의미 역할, 간격 이름을 런타임에 유지해야 한다면 `BrandKit` 및 문서 모델 변경은 별도 이슈에서 명시적으로 승인받아야 한다.

## 출처

- [SEED Design System 저장소](https://github.com/daangn/seed-design) — 패키지 계층과 생성 파이프라인
- [rootage preset README](https://github.com/daangn/seed-design/blob/dev/packages/rootage/README.md) — 생성 대상
- [rootage 색상 토큰](https://github.com/daangn/seed-design/blob/dev/packages/rootage/color.yaml), [글꼴 크기 토큰](https://github.com/daangn/seed-design/blob/dev/packages/rootage/font-size.yaml), [dimension 토큰](https://github.com/daangn/seed-design/blob/dev/packages/rootage/dimension.yaml) — YAML 형식과 값·참조 예시
- [SEED Figma MCP 가이드](https://seed-design.io/ai-integration/figma-mcp) — REST API/PAT 및 플러그인·WebSocket 경로
- [SEED AI & Tools 개요](https://seed-design.io/ai-integration) — Figma 디자인→코드 MCP 제공 범위

# DTCG(Design Tokens Community Group) 형식 호환성 조사

> 조사일: 2026-08-08
>
> 관련 이슈: [#30](https://github.com/Doyajin174/teguma/issues/30)
>
> 상태: 초안 — 웹 검색 rate limit으로 공개 스펙 지식 기반 작성. 라이브 스펙 재검증 항목은 8장에 명시.

## 1. 결론

DTCG "Design Tokens Format Module"은 디자인 토큰을 플랫폼·도구 독립 JSON으로 표현하는 커뮤니티 그룹 표준 초안이다. canonical design token 계약의 **기본 골격($type/$value/$description 규약, 타입 어휘, `{path}` 별칭 문법, 그룹 계층)은 DTCG와 정렬해 채택**하고, **mode·semantic role 확실성·loss manifest처럼 DTCG에 1급 개념이 없는 부분은 canonical 자체의 명시적 필드로 정의**한다. JSON 문서 + JSON Schema(또는 저장소 표준 zod)로만 표현·검증할 수 있어 **새 런타임 의존성 없이 채택 가능**하다.

## 2. DTCG란

- **조직**: W3C Design Tokens Community Group — <https://www.w3.org/community/design-tokens/>
- **산출물**: "Design Tokens Format Module" — <https://tr.designtokens.org/format/> (Draft Community Group Report)
- **지위**: W3C 표준 트랙 정식 권고가 아닌 **커뮤니티 그룹 초안(CG-DRAFT)**. 도구 생태계(Style Dictionary v4, Tokens Studio 등)에서 폭넓게 수용됨.
- **목적**: 색·크기·타이포그래피·모션·모양 같은 디자인 결정을 소스와 무관하게 공유 가능한 토큰 집합으로 정의.

## 3. 형식 구조

문서는 JSON 오브젝트 하나이며, 토큰은 **중첩 그룹**(오브젝트)으로 계층 구성된다.

```jsonc
{
  "color": {
    "brand": {
      "primary": {
        "$type": "color",
        "$value": "#0f766e",
        "$description": "브랜드 기본 색"
      }
    }
  }
}
```

### 3.1 예약 속성 ($ 접두사)

| 속성 | 의미 |
| --- | --- |
| `$type` | 토큰 타입. 그룹에 두면 자식 토큰이 상속. |
| `$value` | 토큰 값. 그룹은 가질 수 없음. |
| `$description` | 사람이 읽는 설명. 그룹 상속 가능. |
| `$extensions` | 도구·벤더별 임의 데이터. 예약 속성명과 충돌 금지. |
| `$deprecated` | boolean 또는 대체 안내 문자열 (후기 초안). |

### 3.2 토큰 타입 (초안 기준)

`color`, `dimension`, `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing`, `duration`, `cubicBezier`, `number`, `gradient`, `shadow`, `transition`, `strokeStyle`, `border`, `radius`, `typography`, `asset`, `string`, `boolean`, `composition` 등.

이슈 최소 타입과의 대응:

| 이슈 최소 타입 | DTCG 타입 | 값 형태 |
| --- | --- | --- |
| color | `color` | hex, `rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`(색 공간 지정), named color |
| dimension/spacing | `dimension` | `"16px"`, `"1rem"`, `"50%"` 등 숫자+단위 문자열. **`spacing`이라는 별도 타입은 없다** — spacing은 dimension 토큰으로 표현 |
| font-family | `fontFamily` | 문자열 또는 문자열 배열 |
| font-weight | `fontWeight` | 100..900 숫자 또는 키워드 |
| font-size | `fontSize` | dimension 또는 키워드 |
| line-height | `lineHeight` | dimension, 단위 없는 숫자(비율), `normal` |
| letter-spacing | `letterSpacing` | dimension, 단위 없는 숫자, `normal` |

조사 대상 타입:

| 타입 | 형태 | 비고 |
| --- | --- | --- |
| `radius` | 단일 값 또는 다중 값(모서리별) | 2024년 이후 초안에 추가 |
| `shadow` | 오브젝트 목록(`$offsetX`/`$offsetY`/`$blur`/`$spread`/`$color`/`$inset`) 또는 CSS 문자열 | |
| `gradient` | 정지점 목록 구조 또는 CSS 문자열 | |
| `duration` | `"150ms"`, `"2s"` | dimension과 유사하나 시간 단위 |

### 3.3 별칭(alias/reference)

- 값이 `"{그룹.경로.토큰}"` 문자열이면 다른 토큰 참조.
- 재귀 해석, **순환 참조 감지**가 요구된다 (SEED `resolveScalar`의 `$` 참조와 동일한 규율).
- 상대 참조(`./`, `../`)는 후기 초안 기능. 절대 경로만으로도 충분.

### 3.4 모드(mode)

- **DTCG 형식에는 1급 `mode` 속성이 없다.** mode는 그룹 분리(light/dark 그룹) 또는 `$extensions` 관례로 다룬다.
- canonical 계약은 **명시적 `mode` 필드를 자체 정의**한다 (관례 의존 배제, 어댑터 간 해석 불일치 방지).

### 3.5 검증

- 커뮤니티에서 JSON Schema 초안과 테스트 스위트를 운영한다.
- JSON으로만 표현·검증 가능 → **새 런타임 의존성 불필요**. 저장소는 이미 zod(v3)를 표준으로 쓰므로, 구현 단계에서 DTCG 정렬 JSON 스키마를 zod 스키마로 직접 작성하면 된다.

## 4. 채택 결정

| 채택 항목 | 근거 |
| --- | --- |
| `$type`/`$value`/`$description` 규약 | 생태계 표준. 도구 간 교환 가능. JSON 스키마로 표현 가능. |
| 타입 어휘: `color`, `dimension`, `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`, `letterSpacing` | 이슈 최소 타입 7종과 1:1 대응. spacing은 dimension으로 표현. |
| `{path}` 별칭 문법 | SEED `$path` 참조와 1:1 매핑 가능. alias 해석 전·후 값을 canonical 필드(`raw`/`value`/`alias`)로 보존하는 구조와 결합. |
| 그룹 계층 | 원본 경로 보존(provenance)에 적합. |
| JSON 스키마 기반 검증 | 무의존성 원칙(이슈: "새 런타임 의존성이나 특정 라이브러리 채택을 선결 조건으로 두지 않는다")과 일치. |

## 5. 배제 결정

| 배제 항목 | 근거 |
| --- | --- |
| DTCG mode 관례(그룹 분리·$extensions) | 어댑터마다 해석이 달라질 위험. canonical은 1급 `mode` 필드로 결정론적으로 표현. |
| `shadow`/`gradient`/`border`/`transition`/`typography`/`composition` 복합 타입 | 현재 어댑터가 생산하는 데이터가 없음 — Penpot `get_tokens`는 미노출, SEED는 `manifest.unsupported`로 보고. v0.2 후보. |
| `radius` 타입(다중 값) | SEED rootage `$radius.r2`(8px) 같은 단일 값은 `dimension` + semanticRole `radius`로 표현 가능. 모서리별 다중 값은 v0.2 후보. |
| `duration` 타입 | SEED rootage `$duration.d3`(150ms)이 fixture에 있으나 현재 어댑터가 소비하지 않음. v0.2 후보(지원 시 `number`+단위 또는 자체 타입 재판정). |
| 상대 별칭(`./`, `../`) | 절대 경로만으로 충분. 순환 검증 단순화. |
| `$deprecated` | v0.1 범위 외. 필요 시 후기 버전에서 채택. |
| DTCG 런타임 라이브러리(Style Dictionary 등) 채택 | 이슈 제약(새 의존성 금지). JSON + zod로 충분. |
| semantic role 확실성·loss manifest | DTCG에 개념 없음 → canonical 자체 1급 필드로 정의(명세 3·4장). |

## 6. canonical 계약에 미치는 영향

- canonical 토큰 문서는 **DTCG와 충돌하지 않는 자체 스키마**: DTCG 예약 속성 규약을 차용하되, mode·provenance·semanticRole·loss는 DTCG `$extensions`에 넣지 않고 1급 필드로 둔다 (소비자 접근성·검증 용이성).
- `{path}` 별칭 문법을 canonical alias 표현에 채택. SEED `$path`는 변환 시 `{...}` 형태로 매핑하거나 canonical id 참조로 정규화.
- 값 문자열(hex, "16px", "1rem")은 DTCG 값 규칙을 따르고, rem→px 환산 정보는 `conversion` 필드로 보존한다 (SEED 기존 회귀 금지 요구).

## 7. 리스크

| 리스크 | 대응 |
| --- | --- |
| DTCG가 정식 W3C 표준이 아닌 CG 초안 → 향후 변경 가능 | canonical `schemaVersion` 고정으로 격리. DTCG 변경 시 매핑 규칙만 갱신. |
| `$type` 상속·그룹 기본값 규칙이 버전마다 미세 변경 | canonical은 그룹 상속을 쓰지 않고 토큰마다 `type`을 명시 → 버전 변화 무관. |
| 도구별 `$extensions` 해석 불일치 | canonical은 `$extensions`를 사용하지 않음. 모든 의미는 1급 필드. |

## 8. 후속 검증 (구현 PR 전)

- 본 조사는 웹 검색 제한(rate limit)으로 공개 스펙 지식 기반이다. 구현 PR 전에 다음을 라이브 확인해야 한다 (별도 이슈 등록 후속):
  - <https://tr.designtokens.org/format/> 최신 초안의 타입 목록·값 문법 (`color`, `dimension`, `radius` 등)
  - 커뮤니티 JSON Schema 초안과 예약 속성 규칙 (특히 `$type` 상속)
  - Style Dictionary v4 / Tokens Studio의 DTCG 채택 범위 (교차 검증용)
- 결정이 갈리면 본 문서의 채택·배제 표를 갱신하고 canonical 명세의 해당 절을 수정한다.


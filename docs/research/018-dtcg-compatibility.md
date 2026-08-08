# DTCG(Design Tokens Community Group) 형식 호환성 조사

> 조사일: 2026-08-08 · 갱신일: 2026-08-08 (2025.10 Final Community Group Report 기준 정정 — 리뷰 반영)
>
> 관련 이슈: [#30](https://github.com/Doyajin174/teguma/issues/30)
>
> 상태: 확정 — 공식 규격(2025.10 Final Community Group Report)과 공식 JSON Schema 기준

## 1. 결론

DTCG "Design Tokens Format Module"은 디자인 토큰을 플랫폼·도구 독립 JSON으로 표현하는 커뮤니티 그룹 표준이다. canonical design token 계약은 **DTCG 문서가 아니라 Teguma의 lossless internal IR**이며, DTCG와의 교환은 별도 projection(canonical ↔ DTCG 2025.10) 경계에서만 수행한다 (명세 3·6.4장).

canonical이 DTCG에서 참조하는 부분:

- **값 구조·단위 규칙** — `color` 구조체, `dimension` `{value, unit}`, `fontWeight` 1..1000/alias, `duration` `{value, unit}`.
- **타입 어휘** — 공식 tokenType 13종과 정렬 (`fontSize`/`lineHeight`/`letterSpacing`/`radius`는 독립 타입이 아님).
- **별칭 문법** — `{path}` 참조 규율(순환 감지 포함).

채택하지 않는 부분:

- **파일 형식 자체** — `$type`/`$value` 예약 속성·그룹 상속은 canonical에 쓰지 않는다. DTCG 파일 형식과의 호환성은 exporter/import projection에서만 정의한다.
- **mode·semantic role 확실성·loss manifest** — DTCG에 1급 개념이 없으므로 canonical 자체의 명시적 필드로 정의한다.

JSON 문서 + JSON Schema(또는 저장소 표준 zod)로만 표현·검증할 수 있어 **새 런타임 의존성 없이 채택 가능**하다.

## 2. DTCG란

- **조직**: W3C Design Tokens Community Group — <https://www.w3.org/community/design-tokens/>
- **기준 문서**: "Design Tokens Format Module 2025.10" — **Final Community Group Report** (안정 발표본)
  - format 모듈: <https://www.designtokens.org/tr/2025.10/format/>
  - color 모듈: <https://www.designtokens.org/tr/2025.10/color/>
- **공식 JSON Schema**: <https://www.designtokens.org/schemas/2025.10/format.json>
- **지위**: W3C 표준 트랙 정식 권고가 아닌 **커뮤니티 그룹 최종 보고서(Final CGR)**. 도구 생태계(Style Dictionary v4, Tokens Studio 등)에서 폭넓게 수용됨.
- **목적**: 색·크기·타이포그래피·모션·모양 같은 디자인 결정을 소스와 무관하게 공유 가능한 토큰 집합으로 정의.

## 3. 형식 구조

문서는 JSON 오브젝트 하나이며, 토큰은 **중첩 그룹**(오브젝트)으로 계층 구성된다.

```jsonc
{
  "color": {
    "brand": {
      "primary": {
        "$type": "color",
        "$value": { "colorSpace": "srgb", "components": [15, 118, 110], "alpha": 1, "hex": "#0f766e" },
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
| `$deprecated` | boolean 또는 대체 안내 문자열. |

### 3.2 토큰 타입 — 공식 13종 (2025.10)

공식 `tokenType` enum:

```
color, dimension, fontFamily, fontWeight, duration, cubicBezier,
number, strokeStyle, border, transition, shadow, gradient, typography
```

**`fontSize`, `lineHeight`, `letterSpacing`, `radius`는 독립 token type이 아니다.** `typography` 타입의 sub-value이거나 `dimension`/`number`로 표현한다.

주요 값 형태:

| 타입 | 값 형태 |
| --- | --- |
| `color` | **구조체** `{ colorSpace, components, alpha?, hex? }` — hex 문자열이 아님. hex는 구조체의 단축 표기 |
| `dimension` | **구조체** `{ value, unit }` — "16px" 문자열이 아님. 공식 단위는 `px` \| `rem` |
| `fontFamily` | 문자열 또는 문자열 배열 |
| `fontWeight` | 1..1000 숫자 또는 규정된 문자열 alias |
| `duration` | `{ value, unit }` (단위 `ms` \| `s`) |
| `cubicBezier` | `[x1, y1, x2, y2]` |
| `number` | 숫자 |
| `strokeStyle` | 오브젝트 (dashArray 등 — 정의는 공식 규격) |
| `border` | 오브젝트 (color·width·style 조합) |
| `transition` | 오브젝트 (duration·delay·timingFunction 등) |
| `shadow` | 그림자 오브젝트 목록 또는 CSS 문자열 |
| `gradient` | 정지점 목록 구조 또는 CSS 문자열 |
| `typography` | typography sub-value 오브젝트 (fontSize·lineHeight·letterSpacing·fontWeight 등 포함) |

**fontSize/lineHeight/letterSpacing/radius의 표현** (독립 타입 아님):

| 구분 | DTCG 2025.10 표현 |
| --- | --- |
| fontSize | `dimension` (또는 `typography`의 sub-value) |
| lineHeight | `dimension` 또는 단위 없는 비율 `number` |
| letterSpacing | `dimension` |
| radius | `dimension` |

### 3.3 별칭(alias/reference)

- 값이 `"{그룹.경로.토큰}"` 문자열이면 다른 토큰 참조.
- 재귀 해석, **순환 참조 감지**가 요구된다 (SEED `resolveScalar`의 `$` 참조와 동일한 규율).
- 상대 참조(`./`, `../`)는 후기 초안 기능. 절대 경로만으로도 충분.

### 3.4 모드(mode)

- **DTCG 형식에는 1급 `mode` 속성이 없다.** mode는 그룹 분리(light/dark 그룹) 또는 `$extensions` 관례로 다룬다.
- canonical 계약은 **명시적 `values.light/dark/default` 필드를 자체 정의**한다 (관례 의존 배제, 어댑터 간 해석 불일치 방지 — 명세 4.2).

### 3.5 검증

- **공식 JSON Schema가 공개되어 있다**: <https://www.designtokens.org/schemas/2025.10/format.json> (2025.10 버전 고정).
- DTCG exporter 출력(명세 6.4)은 이 스키마로 검증한다. canonical 자체는 저장소 표준 zod(v3)로 검증한다 — **새 런타임 의존성 불필요**.

## 4. 채택 결정 (2025.10 기준 갱신)

| 채택 항목 | 근거 |
| --- | --- |
| 값 구조: `color` `{colorSpace, components, alpha?, hex?}`, `dimension` `{value, unit}`(px·rem), `fontWeight` 1..1000/alias, `duration` `{value, unit}` | 손실 없는 구조화 값. 공식 규격 확정. canonical 값 모델의 참조 |
| 타입 어휘 정렬: 공식 13종 | canonical 타입은 DTCG 어휘와 정렬하되 내부 IR 전용. fontSize 등은 `dimension`/`number`+`kind`로 표현 |
| `{path}` 별칭 문법 | SEED `$path` 참조와 1:1 매핑 가능. alias 해석 전·후 값을 canonical 필드(`raw`/`resolvedValue`/`alias`)로 보존 |
| 그룹 계층 | 원본 경로 보존(provenance)에 적합 |
| 공식 JSON Schema | DTCG exporter 출력 검증에 사용 |
| JSON 스키마 기반 검증 | 무의존성 원칙(이슈: "새 런타임 의존성이나 특정 라이브러리 채택을 선결 조건으로 두지 않는다")과 일치 |

**채택하지 않음 (이전 초안과 변경)**:

| 항목 | 사유 |
| --- | --- |
| canonical 자체를 DTCG 파일 형식으로 (`$type`/`$value` 규약 채택) | canonical은 mode·alias·role 확실성·loss 등 DTCG에 없는 정보를 담는 **lossless internal IR**. DTCG 형식 호환은 projection 경계로 분리 (명세 3장) |
| DTCG mode 관례(그룹 분리·`$extensions`) | 어댑터마다 해석이 달라질 위험. canonical은 `values` 필드로 결정론적으로 표현 |
| DTCG 런타임 라이브러리(Style Dictionary 등) | 이슈 제약(새 의존성 금지). JSON + zod로 충분 |

## 5. 배제 결정 (2025.10 기준 갱신)

| 배제 항목 | 근거 |
| --- | --- |
| `cubicBezier`/`strokeStyle`/`border`/`transition`/`typography`/`shadow`/`gradient` 복합 타입 | 현재 어댑터가 생산하는 데이터가 없음 — Penpot `get_tokens`는 미노출, SEED는 `manifest.unsupported`로 보고. v0.2 후보 (canonical 타입 어휘에는 선언) |
| radius 다중 값(모서리별) | SEED rootage `$radius.r2`(8px) 같은 단일 값은 `dimension` + `kind: "radius"`로 표현 가능. 다중 값은 v0.2 후보 |
| 상대 별칭(`./`, `../`) | 절대 경로만으로 충분. 순환 검증 단순화 |
| `$deprecated` | v0.1 범위 외. 필요 시 후기 버전에서 채택 |
| semantic role 확실성·loss manifest | DTCG에 개념 없음 → canonical 자체 1급 필드로 정의(명세 4·6장) |

**참고**: 이전 초안에서 `duration`을 v0.2 후보로 두었으나, 2025.10에서 공식 타입(`{value, unit}`, ms·s)이 확정되어 canonical v0.1에서 지원한다 (명세 4.5).

## 6. canonical 계약에 미치는 영향

- canonical은 **DTCG와 독립된 lossless internal IR**이다. DTCG 호환성은 projection(명세 6.4) 경계에서만 정의하며, canonical 자체에 `$type`/`$value` 규약을 적용하지 않는다.
- 값 형태: `color`는 DTCG color 구조, `dimension`은 `{value, unit}`(px·rem), `fontWeight`는 1..1000/alias, `duration`은 `{value, unit}`(ms·s) — hex 문자열·"16px" 문자열 같은 손실형 표기는 canonical에 쓰지 않는다.
- `fontSize`/`lineHeight`/`letterSpacing`/`radius`는 독립 타입이 아닌 `dimension`/`number` + `kind`로 표현한다.
- `{path}` 별칭 문법을 canonical alias 표현에 채택. SEED `$path`는 변환 시 `{...}` 형태로 매핑하거나 canonical id 참조로 정규화.
- rem→px 환산 정보는 `sourceValue`/`resolvedValue`/`conversion`으로 보존한다 (SEED 기존 회귀 금지 요구 — 명세 4.4).

## 7. 리스크

| 리스크 | 대응 |
| --- | --- |
| DTCG가 정식 W3C 표준이 아닌 CG 최종 보고서 → 이후 버전 변경 가능 | canonical `schemaVersion` 고정으로 격리. DTCG 변경 시 projection(6.4) 매핑 규칙만 갱신 |
| `$type` 상속·그룹 기본값 규칙이 버전마다 미세 변경 | canonical은 그룹 상속을 쓰지 않고 토큰마다 `type`을 명시 → 버전 변화 무관 |
| 도구별 `$extensions` 해석 불일치 | canonical은 `$extensions`를 사용하지 않음. 모든 의미는 1급 필드 |
| 2025.10 이후 신규 버전의 값 구조 변경 | 공식 JSON Schema 버전별로 exporter 출력 검증. 2025.10은 Final CGR로 고정 기준 |

## 8. 후속 검증

- 이전 초안의 "라이브 스펙 재검증 후속 항목"은 **2025.10 Final Community Group Report와 공식 JSON Schema(<https://www.designtokens.org/schemas/2025.10/format.json>)가 공개되어 더 이상 필요 없다**.
- 구현 단계 확인 사항 (구현 PR 범위):
  - DTCG exporter 출력을 공식 format.json으로 검증 (명세 6.4)
  - `colorSpace` 문자열·`fontWeight` alias 등 세부 열거 값은 공식 규격 원문 대조
  - Style Dictionary v4 / Tokens Studio의 2025.10 채택 범위 (교차 검증용, 선택)

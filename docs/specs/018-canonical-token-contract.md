# 통합 디자인 토큰 계약(canonical design token contract) 명세

> 상태: Proposed (조사·명세 완료, 구현 대기)
>
> 작성일: 2026-08-08
>
> 관련 이슈: [#30](https://github.com/Doyajin174/teguma/issues/30) — Refs #22 #23 #28

## 1. 목표

Penpot·SEED·향후 디자인 시스템 어댑터가 **공통으로 생산**하고 Astryx 등 exporter가 **공통으로 소비**하는, 버전 고정 canonical design token 계약을 정의한다.

현재 각 연동은 서로 다른 토큰 의미를 개별 어댑터에서 보정 중이다:

| 어댑터 | mode | role | provenance | loss |
| --- | --- | --- | --- | --- |
| Penpot `get_tokens` (compressor) | 없음 | coarse role(이름 정규식 추론) | path를 name에 합성(분리 저장 안 함) | 암묵적(letterSpacing·textTransform·gradient 탈락, spacing 추론) |
| SEED 변환기 | `theme-light`/`theme-dark`/`default` (컬렉션별 규칙) | 없음(추정 금지) | collection·path·mode 유지 | 구조화된 `manifest.unsupported` |
| Astryx 변환기 | 별도 `modes` wrapper(POC 확장) | `roleOverrides`만 허용(추측 방지) | sourceToken 이름만 | 구조화된 `warnings` + `mapping` 상태 |

이 상태로 어댑터를 더 붙이면 mode·role·provenance·unsupported 보고 형식이 달라지고, 같은 디자인 시스템이 경로에 따라 다르게 해석될 수 있다.

## 2. 설계 원칙

1. **버전 고정** — canonical 문서는 `schemaVersion`을 필수로 갖는다. 계약 변경은 semver로 관리하고 이 문서에 기록한다.
2. **결정론** — 동일 입력은 동일 canonical JSON과 동일 loss manifest를 생성한다. 타임스탬프·랜덤 id·가변 순서 금지. 문서 순서는 입력 순서를 보존한다.
3. **추측 금지** — semantic role은 `explicit | mapped | unknown` 확실성을 함께 가진다. `mapped`(휴리스틱 추론) role은 소비자가 자동 확정하지 못한다. Astryx 등 exporter는 `explicit` 또는 명시적 override만 semantic 변수에 배정한다.
4. **손실은 구조화** — 해석할 수 없는 토큰은 조용히 버리지 않고 `loss` manifest의 `unsupported`/`ambiguous`/`lossy`로 남긴다.
5. **무의존** — JSON 스키마 + 저장소 표준(zod v3, 이미 의존성)으로만 표현·검증한다. 새 런타임 의존성 없음.
6. **호환** — 기존 MCP 도구 계약을 깨지 않는다. canonical은 additive로 노출한다(6장).

## 3. canonical token document 스키마 (v0.1.0)

### 3.1 문서 뼈대

```jsonc
{
  "schemaVersion": "0.1.0",
  "document": {
    "id": "canonical:penpot:<fileId>",
    "sourceAdapter": "penpot",        // "penpot" | "seed"
    "sourceName": "파일/소스 이름",
    "sourceRevision": "..."           // 선택 — 원본 버전/리비전이 있을 때만
  },
  "tokens": [ /* 3.2 */ ],
  "loss": { "unsupported": [], "ambiguous": [], "lossy": [] }   // 3.4
}
```

- `document.id`는 어댑터·소스 id로부터 결정적으로 생성한다 (`canonical:<adapter>:<source-id>`).
- 타임스탬프 계열 필드는 두지 않는다 (결정론 위반).

### 3.2 토큰 객체

```jsonc
{
  "id": "seed:$color.palette.carrot-600",   // 어댑터 범위 안정 id (필수)
  "name": "carrot-600",                      // 표시 이름 (필수)
  "path": "$color.palette.carrot-600",       // 원본 경로 (필수)
  "type": "color",                           // 3.3 타입 (필수)
  "value": "#ff6600",                        // 해석·정규화 후 값 (필수)
  "raw": "#ff6600",                          // 해석 전 원문 — "$"/"{...}" 참조 가능 (필수)
  "unit": "px",                              // dimension 계열만 (선택)
  "conversion": { "from": "rem", "rootFontSizePx": 16 },  // 단위 환산 정보 (선택)
  "mode": "light",                           // "light" | "dark" | "default" (필수)
  "alias": { "ref": "seed:$dimension.x4", "resolved": true },  // 참조 관계 (선택)
  "semanticRole": { "role": "primary", "confidence": "mapped" },  // (선택)
  "provenance": {                            // (필수)
    "adapter": "seed",
    "sourcePath": "$color.palette.carrot-600",
    "sourceId": "seed-poc",
    "collection": "color"                    // SEED 등 어댑터별 추가 정보 (선택)
  },
  "description": "브랜드 기본 색"             // (선택)
}
```

필드 규칙:

| 필드 | 규칙 |
| --- | --- |
| `id` | 어댑터 범위 안정 id. Penpot: `penpot:<fileId>:<colorId|typoId>`, SEED: `seed:<path>` (예: `seed:$dimension.x4`). 변경 금지 — alias·override 참조 대상. |
| `value` / `raw` | `value`는 해석·정규화 후, `raw`는 해석 전 원문. `raw`가 `$...`(SEED) 또는 `{...}`(DTCG) 참조면 `alias` 필드를 함께 기록하고 `value`에는 해석 후 값을 둔다. |
| `alias` | `ref`는 대상 토큰의 canonical `id`. `resolved: true`면 해석 완료, `false`면 해석 불가(순환·미존재)를 뜻하며 이 경우 `value`를 생략할 수 있다. |
| `semanticRole` | `confidence` 의미는 3.5. role이 없으면 필드 자체를 생략(부재 = `unknown`). |
| `mode` | 어댑터가 mode를 모르면 `default`(Penpot). SEED는 `theme-light→light`, `theme-dark→dark`, global 컬렉션→`default`. |
| `unit`·`conversion` | dimension 계열만. rem→px 환산 시 원 단위(`rem`)와 기준 root font-size를 보존한다 — SEED 기존 결과 회귀 금지 요구. |

### 3.3 토큰 타입 (v0.1.0)

최소 타입 7종 — DTCG 타입 어휘와 정렬 (조사 문서 4장):

| type | value 형태 | 비고 |
| --- | --- | --- |
| `color` | `#rrggbb` 또는 `#rrggbbaa` (소문자 정규화) | Penpot opacity는 8자리 hex로 변환하고 `loss.lossy`에 기록 |
| `dimension` | 숫자 + `unit` (`px`/`rem`/…) | spacing 포함 — `semanticRole.role: "spacing"` 부여 가능 |
| `fontFamily` | 문자열 | |
| `fontWeight` | 100..900 정수 | |
| `fontSize` | dimension | |
| `lineHeight` | dimension 또는 단위 없는 숫자(비율) | |
| `letterSpacing` | dimension 또는 단위 없는 숫자 | |

조사 후 판정 결과:

| 타입 | v0.1.0 판정 | 근거 |
| --- | --- | --- |
| radius | 별도 타입 없이 `dimension` + `semanticRole.role: "radius"` | SEED `$radius.r2`(8px) 같은 단일 값은 dimension으로 충분. 모서리별 다중 값(radius 4-way)은 v0.2. |
| shadow | v0.2 후보 | 현재 어댑터가 생산하는 데이터 없음(Penpot 미노출, SEED는 unsupported 보고). |
| gradient | v0.2 후보 | Penpot `PenpotColor.gradient`은 compressor에서 탈락 중 — v0.2에서 손실 없이 보존하는 방안 조사. |
| duration/motion | v0.2 후보 | SEED `$duration.d3`(150ms) 존재하나 소비처 없음. 지원 시 `number`+단위 또는 자체 타입 재판정. |

### 3.4 loss manifest

| 범주 | 의미 | 항목 필드 |
| --- | --- | --- |
| `unsupported` | 어댑터가 해석할 수 없음 (범주·단위·구조) | `path`, `reason`, `raw`(원문, 복합 구조는 JSON 문자열) |
| `ambiguous` | 값은 있으나 의미를 확정할 수 없음 | `path`, `reason`, `candidates?` |
| `lossy` | 변환 과정에서 정보가 변형·소실됨 | `path`, `kind`, `description`, `original?`, `converted?` |

기존 보고 형식과의 대응:

| 기존 형식 | canonical loss |
| --- | --- |
| SEED `manifest.unsupported` (범주·단위·mode 부재) | `unsupported`로 그대로 이동 (raw 보존) |
| Penpot compressor의 암묵적 탈락(letterSpacing·textTransform·gradient) | `lossy`/`unsupported`로 명시화 |
| Penpot spacing 추론(GCD base unit·기본 스케일) | `lossy` (추론임을 명시) |
| Astryx `warnings`(MISSING_ROLE 등)·`mapping` conflict | `ambiguous`로 병기 (canonical은 어댑터가 아니라 소비 결과를 다루므로, 충돌은 소비 단계에서도 보고) |

### 3.5 semantic role 확실성

| confidence | 의미 | 자동 매핑 허용 |
| --- | --- | --- |
| `explicit` | 원본이 role을 선언 (SEED 컬렉션 의미·rootage 명시, Astryx `roleOverrides`, 사용자 지정) | 허용 (registry 검증 후) |
| `mapped` | 휴리스틱 추론 (Penpot `inferColorRole` 정규식 — `primary`/`secondary`/`neutral`/`semantic`/`surface`/`text`) | **금지** — 소비자는 override를 요구하거나 `ambiguous` 보고 |
| `unknown` | role 없음 (필드 생략과 동일) | 금지 |

## 4. 어댑터 4종

### 4.1 Penpot compressed token → canonical

- 입력: `PenpotFile` + `compressBrandContext` 결과(압축 토큰).
- colors:
  - `name`(path/name 합성)은 `path`와 `name`으로 분리해 보존 (`provenance.sourcePath`).
  - `value`의 `@NN%` 불투명도 접미사는 8자리 hex로 변환하고 `loss.lossy`에 원문 기록 (Astryx `normalizeColorValue`의 "UNSUPPORTED" 탈락 문제 해소).
  - `role`은 `semanticRole.confidence: "mapped"`로 보존 — 출처가 정규식 추론임을 명시. Astryx가 자동 확정하지 못한다.
  - gradient가 있으면 `loss.unsupported` 또는 `lossy`로 보고 (v0.2에서 보존).
- typography: `scale` 항목을 토큰별로 분해 — `fontSize`/`fontWeight`/`lineHeight`(비율은 단위 없는 숫자), letterSpacing·textTransform은 현재 탈락 → `lossy` 명시 후 v0.2에서 보존.
- spacing: shape에서 추론한 `baseUnit`·`scale`은 `dimension` 토큰 + `loss.lossy`("추론") 기록.
- mode: `default` (Penpot에 light/dark 없음). alias: 없음(flat 구조). provenance: `penpot:<fileId>` + 원본 id.

### 4.2 SEED rootage → canonical

- 입력: `SeedRootageFile` + `SeedTransformOptions`(mode·rootFontSizePx).
- `SeedManifest.tokens` → canonical 토큰. `category` → `type` 매핑: `dimension→dimension`, `font-family→fontFamily`, `font-weight→fontWeight`, `font-size→fontSize`, `line-height→lineHeight`, `letter-spacing→letterSpacing`, `color→color`.
- mode: `theme-light→light`, `theme-dark→dark`, `default→default`.
- `raw`가 `$` 참조면 `alias.ref` = 대상 토큰 id, `value` = 해석 후 값 (기존 `resolveScalar` 순환 감지 재사용).
- rem→px 환산은 `unit: "rem"` + `conversion.rootFontSizePx` 보존 — 기존 결과 회귀 금지.
- `manifest.unsupported` → `loss.unsupported` (필드 그대로 이동). color에 `default` 요청 시의 unsupported 보고도 동일.
- semanticRole: rootage에 role 개념 없음 → 부재(unknown). 단, `provenance.collection`(`color`/`global`)을 보존해 역할 판단 근거로만 사용.

### 4.3 canonical → BrandKit / DesignDocument projection

- projection 파라미터: `mode` (필수 — `light`/`dark`/`default`), 선택적으로 `kitId`·`kitName`.
- palette: 요청 mode와 일치하는 `color` 토큰만. 요청 mode에 색상 토큰이 없으면(SEED `default` 호출과 동일) `loss.ambiguous` 보고 후 palette 생략 — 기존 정책 유지.
- fonts: `fontFamily` + `fontWeight` 토큰으로 family별 weight 목록. family↔weight 연관이 없는 경우 `loss.lossy`("합집합 등록 — 기존 POC 한계") 명시.
- radius/shadow/gradient/duration 등 BrandKit이 표현 못 하는 타입 → `loss.unsupported`.
- DesignDocument 생성은 기존 `buildSeedDocument` 로직을 projection의 별도 단계로 일반화 (대표 문서 생성 정책은 v0.2에서 문서화).
- 기존 `SeedTransformResult`의 `manifest`/`brandKit`/`typography`/`spacing`/`document` 필드는 유지 — canonical은 additive 필드로 추가.

### 4.4 canonical → Astryx theme draft

- 입력: canonical token document + (선택) `roleOverrides` — projection 파라미터로, **canonical token `id`를 참조**한다 (현행 이름 문자열 의존 제거).
- 출력: 기존 `AstryxThemeDraft` 유지. **별도 `modes` wrapper가 불필요해진다** — canonical이 mode 분리를 제공하므로 `modes.light`/`modes.dark`를 canonical 토큰에서 직접 채운다.
- 매핑 규칙:
  - `semanticRole.confidence === "explicit"` 토큰만 `COLOR_ROLE_REGISTRY`와 매칭 시도.
  - `mapped`(Penpot 추론 role)는 **자동 매핑 금지** → `unmapped` + `MISSING_ROLE`/`UNSUPPORTED_TOKEN` 경고 (현행 no-guess 원칙 유지).
  - override는 canonical `id` 기반으로 명시적 role을 부여 → `explicit`로 취급.
- 충돌(M3 규칙: 한 번 conflict로 내려간 변수는 복원 금지) → `mapping.status: "conflict"` + `loss.ambiguous` 병기.
- typography/spacing: 현행 규칙 유지(4/8 base unit, 단조 증가·배수 검사 등). 위반은 `unmapped` + 경고.
- mode 누락(light만 존재 등): 기존 `MISSING_DARK_MODE`/`MISSING_LIGHT_MODE` 경고를 `loss.ambiguous`로 병기.
- `roleOverrides`는 canonical id 참조로 바뀌므로, 기존 get_tokens 이름 기반 override는 migration 기간 동안 이름→id 역참조 맵으로 지원.

## 5. 완료 시나리오 (이슈 본문 기준)

1. 사용자가 SEED rootage의 light/dark 토큰을 가져오거나 Penpot 파일에서 토큰을 읽는다.
2. 두 입력 모두 같은 버전의 canonical token document로 정규화된다 — 4.1·4.2 어댑터가 `schemaVersion` 동일 문서를 생산.
3. 원본 이름·경로·타입·mode·alias 관계·semantic role 확실성·단위·출처가 보존된다 — 3.2 필드(provenance·alias·semanticRole·unit/conversion)로 보장.
4. Astryx exporter가 별도 임시 `modes` wrapper 없이 canonical을 소비하고, 확정할 수 없는 role만 override 요구 또는 loss 보고로 반환한다 — 4.4.
5. 동일 입력은 동일 canonical JSON과 동일 loss report를 생성한다 — 원칙 2(결정론) + loss 항목의 입력 순서 보존.

## 6. 호환성·migration

### 6.1 선택: additive 파라미터 (v0.1.0)

`get_tokens`에 **`includeCanonical?: boolean`(기본 false)** 파라미터를 추가한다. `true`면 응답에 `canonical` 필드(전체 canonical 문서)를 덧붙인다.

선택 근거:
- Penpot 파일 fetch를 1회 재사용 (별도 도구는 fetch 중복).
- 기본 동작 불변 → 기존 소비자 무영향.
- canonical payload 자체가 `schemaVersion`으로 versioned → additive로도 버전 관리 충분.
- SEED는 `transformSeedRootage` 결과에 additive `canonical` 필드 추가 (기존 필드 유지).

### 6.2 migration 경로

| 단계 | 상태 | 내용 |
| --- | --- | --- |
| v0 (현재) | 운영 중 | `get_tokens` 압축 형식만 존재. |
| v0.1 | 이 이슈 구현 후 | `includeCanonical` 기본 off. canonical은 새 기능으로만 노출. 기존 형식 유지. |
| v1.0 | 후속 | `includeCanonical` 기본 on. 기존 압축 형식은 canonical→projection 결과임을 명시. Astryx `modes` wrapper deprecated. |
| v2.0 | 후속 | 기존 압축 형식 필드 제거 예정. 모든 소비자는 canonical + projection 사용. |

### 6.3 Astryx 전용

- `AstryxThemeInput`에 canonical 소비 경로 추가 (기존 `modes`·`roleOverrides` 입력은 deprecated 표시).
- `roleOverrides`의 참조를 canonical `id`로 전환. 기존 이름 참조는 migration 맵으로 지원.

## 7. 완료 조건 (Definition of Done)

### 7.1 본 이슈 범위 (조사·명세)

- [x] DTCG 호환성 조사 문서 — `docs/research/018-dtcg-compatibility.md`
- [x] versioned canonical token schema + 예시 JSON 명세 — 본 문서
- [ ] (구현 PR에서) Penpot·SEED·Astryx 토큰 계약의 공통점·손실 지점 조사가 본 문서 1·3·4장에 반영됨 — 리뷰 확인

### 7.2 구현 단계 (후속 PR — 이 이슈의 구현 범위)

- [ ] zod 기반 canonical 스키마 (`src/design/canonical-token.ts` 등) — 저장소 표준 zod v3, 새 의존성 없음
- [ ] mode·alias·provenance·semantic certainty·loss manifest를 포함한 fixture
- [ ] Penpot fixture와 SEED fixture가 같은 canonical contract로 변환됨 (4.1·4.2)
- [ ] 기존 SEED mode·참조·단위 결과가 회귀 없이 보존됨 (manifest 유지 + canonical additive)
- [ ] Astryx 변환기가 canonical을 소비하고 모호한 role을 추측하지 않음 (4.4, `mapped` 자동 매핑 금지)
- [ ] 기존 `BrandKit`/`DesignDocument` 소비자를 위한 projection (4.3) + migration 문서 (6장)
- [ ] 동일 입력의 canonical JSON·manifest 결정론 테스트
- [ ] 전체 테스트·빌드 통과
- [ ] PR → 셀프 리뷰 → 독립 AI 리뷰 → squash merge

## 8. 예시 JSON

### 8.1 SEED → canonical (축약)

```jsonc
{
  "schemaVersion": "0.1.0",
  "document": { "id": "canonical:seed:seed-poc", "sourceAdapter": "seed", "sourceName": "Seed POC" },
  "tokens": [
    {
      "id": "seed:$color.palette.carrot-600",
      "name": "carrot-600",
      "path": "$color.palette.carrot-600",
      "type": "color",
      "value": "#ff6600",
      "raw": "#ff6600",
      "mode": "light",
      "provenance": { "adapter": "seed", "sourcePath": "$color.palette.carrot-600", "sourceId": "seed-poc", "collection": "color" }
    },
    {
      "id": "seed:$dimension.spacing-x.global-gutter",
      "name": "global-gutter",
      "path": "$dimension.spacing-x.global-gutter",
      "type": "dimension",
      "value": 16,
      "raw": "$dimension.x4",
      "unit": "px",
      "mode": "default",
      "alias": { "ref": "seed:$dimension.x4", "resolved": true },
      "semanticRole": { "role": "spacing", "confidence": "explicit" },
      "provenance": { "adapter": "seed", "sourcePath": "$dimension.spacing-x.global-gutter", "sourceId": "seed-poc", "collection": "global" },
      "description": "화면 전체에 적용되는 기본 수평 padding 값입니다."
    }
  ],
  "loss": {
    "unsupported": [
      { "path": "$radius.r2", "reason": "token category \"radius\" is out of POC scope", "raw": "{\"values\":{\"default\":\"8px\"}}" },
      { "path": "$duration.d3", "reason": "token category \"duration\" is out of POC scope", "raw": "{\"values\":{\"default\":\"150ms\"}}" }
    ],
    "ambiguous": [],
    "lossy": [
      { "path": "$font-size.t1", "kind": "unit-conversion", "description": "rem→px 환산", "original": "0.6875rem", "converted": "11px" }
    ]
  }
}
```

### 8.2 Penpot → canonical (축약)

```jsonc
{
  "schemaVersion": "0.1.0",
  "document": { "id": "canonical:penpot:<fileId>", "sourceAdapter": "penpot", "sourceName": "Example File" },
  "tokens": [
    {
      "id": "penpot:<fileId>:<colorId>",
      "name": "Primary",
      "path": "Brand/Primary",
      "type": "color",
      "value": "#ff6600",
      "raw": "#ff6600",
      "mode": "default",
      "semanticRole": { "role": "primary", "confidence": "mapped" },
      "provenance": { "adapter": "penpot", "sourcePath": "Brand/Primary", "sourceId": "<colorId>" }
    },
    {
      "id": "penpot:<fileId>:<typoId>",
      "name": "Body",
      "path": "Typography/Body",
      "type": "fontSize",
      "value": 16,
      "raw": "16",
      "unit": "px",
      "mode": "default",
      "provenance": { "adapter": "penpot", "sourcePath": "Typography/Body", "sourceId": "<typoId>" }
    }
  ],
  "loss": {
    "unsupported": [],
    "ambiguous": [],
    "lossy": [
      { "path": "Typography/Body", "kind": "dropped-property", "description": "letterSpacing/textTransform은 v0.1에서 보존하지 않음", "original": "<원문>" }
    ]
  }
}
```

## 9. 비범위

- 의미가 불명확한 색상을 이름만 보고 primary/error 등으로 자동 확정 (원칙 3)
- SEED·Astryx React 컴포넌트 런타임 통합
- Penpot을 유일한 원본 저장소로 강제
- 토큰 동기화 충돌 자동 해결
- shadow/gradient/duration/다중 값 radius 구현 (v0.2 후보 — 조사 문서 5장)


# 데모 워크플로: Figma + Claude Design vs teguma

> 시나리오: "기존 디자인 시스템으로 새 결제 대시보드 화면 만들기"

---

## Figma + Claude Design 경로

### Step 1: 디자인 시스템 컨텍스트 전달

사용자가 스크린샷 3장 + 브랜드 가이드라인 PDF를 첨부하고
"Primary는 #6366f1, Inter 폰트, 8px 그리드..."라고 수동 설명.

**문제점**:
* 스크린샷은 AI가 정확히 파싱 못 함
* PDF는 토큰 많이 먹음
* 수동 설명은 누락 발생
* 매 세션마다 반복해야 함

### Step 2: AI가 화면 생성

Claude Design이 HTML 파일 생성.

**문제점**:
* 결과물이 "LLM boilerplate" — 전부 비슷
* 뷰포트 오버플로 빈번
* 디자인 시스템 토큰 안 지킴 (임의 색상 사용)
* 단일 HTML 파일 — 컴포넌트 분리 없음

### Step 3: 수정 반복

"버튼 색상이違います", "카드가 화면 밖으로 나갑니다", "간격이 8px 그리드 안 맞습니다"

**문제점**:
* 매 수정마다 전체 컨텍스트 재전달
* 토큰 소모 누적
* "마지막 20%"가 전체 시간의 80%

### Step 4: Figma에 수동 재작업

디자이너가 Claude 출력 보고 Figma에서 처음부터 재작업.

**문제점**:
* 라운드트립 불가
* AI 작업이 사실상 폐기
* 이중 작업

**총 소요: 2~4시간, 토큰 ~50K+, 브랜드 정합성 낮음**

---

## teguma + Penpot 경로

### Step 1: 컨텍스트 자동 로드 (1회 호출)

```
AI -> get_design_context(fileId: "abc123")
```

응답 (~200 토큰):
```
# Acme Design System
3 pages, 24 components, 18 colors defined.

## Colors
* brand/Primary: #6366f1 (primary)
* brand/Secondary: #8b5cf6 (secondary)
* base/Neutral-100: #f5f5f5 (neutral)
* semantic/Error: #ef4444 (semantic)

## Typography
Families: Inter
Base: 16px
Scale:
  Caption: 12px/1.4 w400
  Body: 16px/1.5 w400
  H1: 32px/1.2 w700

## Spacing
Base: 8px | Scale: 4, 8, 12, 16, 24, 32, 48, 64

## Components
* ui/button [size:sm|md|lg, variant:primary|secondary|ghost]
* ui/card [elevation:flat|raised|overlay]
* ui/form/input [state:default|focus|error]
```

**해결**: P1(임포트 파괴), P5(토큰 소모) — 자동, 압축, 1회

### Step 2: 가드레일 수신 (1회 호출)

```
AI -> get_constraints(fileId: "abc123")
```

응답:
```json
{
  "breakpoints": [375, 768, 1024, 1440],
  "maxContentWidth": 1440,
  "guardrails": [
    "MUST: Keep all content within frame boundaries",
    "MUST: Use spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px",
    "MUST: Use defined color tokens only (18 available)",
    "MUST NOT: Exceed max content width of 1440px",
    "SHOULD: Align to 8px grid"
  ],
  "availableComponents": ["ui/button", "ui/card", "ui/form/input"]
}
```

**해결**: P4(레이아웃 경계), P3(제네릭 출력) — 제약 조건 강제

### Step 3: AI가 제약 내에서 생성

AI가 가드레일을 지키면서 코드 생성:
* #6366f1만 사용 (임의 색상 불가)
* 8px 그리드 정렬
* 1440px 이내
* 기존 컴포넌트 참조

**해결**: P3, P4 — 구조적으로 방지

### Step 4: Penpot에 직접 생성

```
AI -> create_element(fileId, pageId, type: "board",
     name: "Payment Dashboard", width: 1440, height: 1024)

AI -> create_element(fileId, pageId, type: "text",
     name: "page-title", text: "결제 대시보드", x: 24, y: 24)
```

**해결**: P6(라운드트립) — AI가 직접 Penpot에 쓰기

### Step 5: Penpot에서 팀 협업

* 디자이너가 Penpot에서 미세 조정
* 버전 관리 자동
* 소스 오브 트루스 유지

**해결**: P8(SoT), P9(라이프사이클)

**총 소요: 15~30분, 토큰 ~5K, 브랜드 정합성 높음**

---

## 정량 비교

| 지표 | Figma + Claude Design | teguma + Penpot |
|------|:---:|:---:|
| 소요 시간 | 2~4시간 | 15~30분 |
| 토큰 소모 | ~50K+ | ~5K |
| 반복 횟수 | 5~10회 | 1~2회 |
| 브랜드 정합성 | 낮음 (수동) | 높음 (자동 강제) |
| 라운드트립 | 불가 | 가능 |
| 팀 협업 | 수동 재작업 | Penpot에서 직접 |
| 비용 (API) | 높음 | 1/10 |

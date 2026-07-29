# Figma .fig 파일 포맷 리서치 (M3 기반)

> 조사일: 2026-07-30
> 목적: .fig → Penpot 변환 브릿지 구현을 위한 기술 조사

---

## .fig 파일 구조

Figma .fig 파일은 **Kiwi 스키마 기반 바이너리 포맷**입니다.

- ZIP 컨테이너 내부에 바이너리 데이터
- Google Kiwi 스키마 언어로 직렬화
- scenegraph, styles, components, images 등 섹션 포함
- 공식 문서 없음 — 리버스 엔지니어링으로 파악

---

## 기존 오픈소스 도구

### figma-kiwi-protocol (MIT, 36 stars)

- GitHub: allan-simon/figma-kiwi-protocol
- Figma의 바이너리 Kiwi wire 프로토콜 디코딩
- WebSocket 프레임에서 scenegraph, SVG, CSS 추출
- REST API 레이트 리밋 우회 가능
- 구조: kiwi.mjs (디코더), scenegraph.mjs, css.mjs, svg.mjs
- **한계**: 라이브 세션 프로토콜 중심, .fig 정적 파일 파싱은 별도 작업 필요

### Figma REST API (공식)

- GET /v1/files/:key — 파일 전체 구조 (JSON)
- GET /v1/files/:key/components — 컴포넌트
- GET /v1/files/:key/styles — 스타일
- **장점**: 공식 지원, JSON 응답
- **한계**: 레이트 리밋 (30 req/min), .fig 바이너리 직접 파싱 아님

### BuilderIO/figma-html (MIT, 3.6K stars)

- 웹사이트 → Figma 디자인 변환 (역방향)
- HTML/CSS → Figma 플러그인 API로 임포트
- **시사점**: Figma 플러그인 API가 임포트 경로로 활용 가능

---

## M3 구현 전략 (제안)

### 경로 A: Figma REST API → Penpot (권장)

```
Figma REST API (JSON) → teguma 변환기 → Penpot RPC API
```

- Figma Personal Access Token으로 파일 구조 조회
- JSON → Penpot 네이티브 형식 매핑
- .fig 바이너리 파싱 불필요 (API가 JSON 제공)
- 레이트 리밋 관리 필요 (배치 + 캐싱)

### 경로 B: .fig 바이너리 직접 파싱

```
.fig 파일 → Kiwi 디코더 → scenegraph → Penpot 변환
```

- 오프라인 변환 가능 (API 불필요)
- Kiwi 스키마 리버스 엔지니어링 필요
- figma-kiwi-protocol 기반 확장 가능
- 복잡도 높음, 유지보수 부담

### 경로 C: Figma 플러그인 API 경유

```
Figma Plugin → JSON export → teguma → Penpot
```

- Figma 플러그인에서 디자인 시스템 JSON 추출
- teguma가 JSON → Penpot 변환
- 사용자 수동 단계 필요 (플러그인 실행)

---

## 매핑 테이블 (Figma → Penpot)

| Figma 개념 | Penpot 개념 | 비고 |
|-----------|------------|------|
| File | File | 1:1 |
| Page | Page | 1:1 |
| Frame | Board/Frame | Auto Layout → Flex Layout |
| Component | Component | variantProperties 매핑 |
| Component Set | Variant Container | |
| Style (Color) | Color Library | |
| Style (Text) | Typography Library | |
| Effect | Shadow/Blur | |
| Auto Layout | Flex Layout | direction, gap, padding |
| Constraints | Layout Constraints | |
| Variables | Design Tokens | tier 매핑 |

---

## 다음 단계

1. Figma REST API 응답 구조 상세 분석 (실제 파일으로)
2. Penpot RPC "commit-changes" API의 정확한 스키마 파악
3. 경로 A 프로토타입 구현
4. 컴포넌트/변형 보존율 테스트

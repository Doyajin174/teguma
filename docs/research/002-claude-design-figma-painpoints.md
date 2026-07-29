# Claude Design + Figma 커뮤니티 페인포인트 수집

> 조사일: 2026-07-30
> 출처: Hacker News (324pt/266코멘트, 122pt/98코멘트 스레드), HN 코멘트 검색
> 방법: HN Algolia API + 수동 분류

---

## 핵심 페인포인트 (빈도·강도 순)

### P1. 디자인 시스템 임포트가 깨져있음

> "I tried uploading our design system. Claude Design's environment was so limited it had to reimplement it from scratch in HTML, JS and CSS. Doing that burned through more than half the token limit. Along the way it completely changed it and made up things that don't fit in at all, neither visually or as code."

> "I couldn't even import our brand guidelines into make which is already a .fig — like what are we even doing here, guys?"

**본질**: 기존 Figma 디자인 시스템(.fig)을 AI 도구가 소화 못 함. 토큰 제한에 걸리고, 재해석 과정에서 브랜드 정체성이 파괴됨.

---

### P2. 산출물이 프로덕션에 쓸 수 없음

> "The output of making a mockup is one huge HTML file with minified CSS that just can't be used."

> "This largely appears to be a HTML generator at its core, not necessarily what Figma does with layers/canvases etc."

**본질**: 결과물이 단일 HTML 파일. 컴포넌트 분리 없음, 디자인 토큰 없음, 재사용 불가. "프로토타입"이지 "디자인 산출물"이 아님.

---

### P3. 결과물이 전부 비슷함 (LLM boilerplate)

> "The designs often look very similar and generally adhere to contemporary web tropes."

> "Just like SaaS boilerplate from the decade prior, there is LLM boilerplate."

> "It looks like any other llm slop website design. The grain effect, the extra long FAQ, the reveal animations, the bad combination of font sizes and contrast ratios."

**본질**: 프롬프트에 명시적 스타일 지시 없으면 "안전한 평균"으로 수렴. 비정형·브루탈리스트·독자적 미학 구현이 어려움.

---

### P4. 레이아웃 경계 개념 없음

> "Claude Design has zero concept of layout boundaries, happily making slides that expand 200% or more out of the visible viewport. I have a lot of content and it just can't figure out nice ways of presenting it."

**본질**: 캔버스/프레임 제약 조건을 이해 못 함. Figma의 Auto Layout, Constraints에 해당하는 구조적 개념이 부재.

---

### P5. 토큰 소모가 미쳤고 반복이 느림

> "CD crunches through ungodly amount of tokens and is really slow on iteration."

> "Doing that burned through more than half the token limit."

**본질**: 디자인 시스템 컨텍스트 로딩 자체가 토큰을 잡아먹음. 반복(iteration) 비용이 높아 "일단 돌려보고"가 어려움.

---

### P6. 라운드트립 불가 (단방향 워크플로)

> "But then how do they get it back out from Figma and make it live?"

> "Most design tools assume you start in Figma and build toward code. This workflow is reversed."

**본질**: AI → 디자인, 디자인 → 코드, 코드 → 디자인 양방향 동기화가 안 됌. 한 번 생성하면 그 뒤 수동.

---

### P7. "마지막 20%" 문제

> "It's great for 80%, the last 20% still needs judgment."

> "I still ended up going back to tweak things manually."

**본질**: AI가 80%까지 빠르게 가지만, 픽셀 퍼펙트·브랜드 정합성·접근성 등 마지막 마무리가 항상 수동. 이 20%가 전체 공수의 80%.

---

### P8. 소스 오브 트루스가 될 수 없음

> "I don't see claude design ever working as your source of truth."

> "Modern Figma design libraries are one of the best things to happen to product teams — reusable components, shared styles, auto layout, variants, design tokens, versioned libraries, a single source of truth."

**본질**: 버전 관리, 컴포넌트 라이브러리, 팀 공유가 안 됨. "한 번 쓰고 버리는" 산출물.

---

### P9. 협업·리뷰·에셋 관리 라이프사이클 부재

> "A lot of design has a deeper life-cycle than that. There's the collaboration, pitching, review, iteration, asset management, etc."

> "Written specifications are being reduced in favor of these working prototypes, and now there's this extra cognitive burden of reading the code and trying to determine what were the intended changes."

**본질**: 디자인은 "산출물"이 아니라 "프로세스". AI 도구가 프로세스 전체를 커버 못 함.

---

### P10. Penpot MCP 연동은 되지만 제네릭

> "Claude Design into PenPot via its MCP was a really neat flow, for something generic looking anyway. With the correct prompts it even built out reusable PenPot components and design system tokens."

**본질**: 기술적 다리는 존재. 그러나 "generic looking" — 브랜드/시스템 컨텍스트가 전달되지 않음.

---

## 커뮤니티에서 emergent한 워크플로 패턴

1. **Claude Design → 수동 Figma 재작업**: 시안 탐색은 AI, 최종은 Figma (가장 흔함)
2. **Figma 디자인 시스템 → Claude Code에 주입 → 코드로 직접 디자인**: Figma를 아예 건너뜀
3. **Claude Design → Penpot MCP**: 오픈소스 경로, 아직 제네릭
4. **스크린샷/레퍼런스 사이트 → Claude에 스타일 참조**: 비정형 미학 우회로

---

## 마개조 방향 시사점

| 페인포인트 | 우리가 풀 수 있는 것 |
|-----------|-------------------|
| P1 디자인 시스템 임포트 | Penpot/open-design에 .fig → 네이티브 변환 파이프라인 |
| P2 산출물 품질 | 컴포넌트 분리 + 디자인 토큰 자동 추출 |
| P3 제네릭 출력 | 브랜드 컨텍스트 주입 레이어 (DESIGN.md / 토큰 파일) |
| P4 레이아웃 경계 | 캔버스 제약 조건을 AI에 전달하는 스키마 |
| P5 토큰 소모 | 디자인 시스템 압축 표현 (전체 HTML 대신 토큰+구조만) |
| P6 라운드트립 | 양방향 동기화 (코드 ↔ 디자인) |
| P7 마지막 20% | AI가 "여기서부터 수동" 경계를 명시 |
| P8 소스 오브 트루스 | Penpot을 SoT로 + AI는 편집자 역할 |
| P9 라이프사이클 | Penpot의 기존 협업 기능 활용 |
| P10 제네릭 MCP | 브랜드 컨텍스트 포함 MCP 서버 개선 |

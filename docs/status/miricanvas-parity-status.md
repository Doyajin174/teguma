# 미리캔버스 파리티 — 진행 상태 한눈에 보기

> 갱신: 2026-08-08 (v0.4.0 머지 기준)
> 관련: [#13](https://github.com/Doyajin174/teguma/issues/13), [#18](https://github.com/Doyajin174/teguma/issues/18)

**결론: 진행 중 (완성 아님). 뼈대는 잡혔고, 살은 붙이는 단계.**

---

## 1. 완료 ✅ (머지됨)

| 기능 | 위치 | PR |
|---|---|---|
| 문서 모델 (다중 페이지·레이어·좌표) | `src/design/document.ts` | #20 |
| 사이즈 프리셋 14종 (유튜브·인스타·네이버 등) | `src/design/presets.ts` | #20 |
| 리사이즈 엔진 (채우기/맞추기/원본·비율고정) | `src/design/resize.ts` | #20 |
| 브랜드 키트 (로고·팔레트·폰트, 위반 검출) | `src/design/brand-kit.ts` | #20 |
| 내보내기 SVG/PNG/JPG/PDF | `src/design/export.ts` | #20 |
| 자동 QA (캔버스 이탈·겹침·대비·안전영역) | `src/design/qa.ts` | #20 |
| MCP 도구 23개 노출 | `src/server.ts` | #20 |
| 웹 에디터 기본 (레이어 이동·리사이즈·미리보기) | `web/` | #21 |

## 2. 코드엔 있지만 이슈 미마감 ⚠️ (검증/정리 필요)

> 분리 시점에 코어와 얽혀 함께 머지됨. 이슈가 열려 있는 상태.

| 이슈 | 기능 | 코드 위치 |
|---|---|---|
| [#14](https://github.com/Doyajin174/teguma/issues/14) | 실제 JPEG 인코딩 | `src/design/jpeg.ts` |
| [#15](https://github.com/Doyajin174/teguma/issues/15) | PPTX·MP4·GIF 내보내기 | `src/design/pptx.ts`, `mp4.ts`, `gif.ts` |
| [#17](https://github.com/Doyajin174/teguma/issues/17) | 브랜드 정책 게이트 (승인·금지어·권한) | `src/design/policy.ts` |

**결정 필요:** 이 이슈들을 (a) 검증 후 닫을지, (b) 추가 보강 후 닫을지.

## 3. 시작도 안 함 ❌

| 이슈 | 내용 |
|---|---|
| [#16](https://github.com/Doyajin174/teguma/issues/16) | 디자인 템플릿 라이브러리 |
| [#1](https://github.com/Doyajin174/teguma/issues/1) | Figma .fig → Penpot 변환 브릿지 |
| [#9](https://github.com/Doyajin174/teguma/issues/9) | lint 게이트 복구 (기술부채) |
| [#19](https://github.com/Doyajin174/teguma/issues/19) | Open Design + Penpot 연동 환경 |

## 4. 미리캔버스가 가진데 우리가 아직 없는 것

- 미리클 AI (이미지 생성·배경 제거·리디자인·라이팅·페이지 추천)
- 라이선스 템플릿 물량 (53만 템플릿 — 복제 대상 아님, 자체 템플릿으로 대체 예정)
- 승인·금지어·권한의 완전한 운영 게이트
- 모바일/협업/버전 관리

---

## 참고: 용어 안 헷갈리기

| 용어 | 의미 |
|---|---|
| **미리캔버스** | 국내 웹 디자인 도구 (캔바류). 우리가 "기능을 따라잡을" 기준 서비스 |
| **teguma** | 우리 프로젝트. Penpot MCP 브릿지 + 디자인 엔진 |
| **디자인 엔진 (#13)** | AI가 쓰는 백엔드 (문서→이미지 생성 기능) |
| **웹 에디터 (#18)** | 사람이 브라우저에서 쓰는 화면 (엔진 재사용) |

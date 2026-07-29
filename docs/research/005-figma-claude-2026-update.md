# Figma + Claude Design 2026년 7월 최신 동향

> 조사일: 2026-07-30
> 출처: Anthropic 블로그, Figma 블로그, Reddit, Figma 포럼

---

## 주요 업데이트 (2026.04~07)

### 1. Figma 에이전트 출시
- Figma 자체 AI 에이전트: 피드백 정리, 변경 적용, 코드↔디자인↔디자인 시스템 간 작업
- "Skills" 개념: /figma-use 스킬로 팀 디자인 규칙을 AI에 주입
- **teguma 시사점**: Figma도 브랜드 컨텍스트 주입의 중요성을 인식. 우리의 get_constraints와 동일한 방향.

### 2. Figma MCP 공식 지원 확대
- Claude/Claude Code가 Figma Design, Make, FigJam 읽기/쓰기 가능
- "Claude Code to Figma": 실행 중인 웹 UI → 편집 가능한 Figma 프레임 변환
- **teguma 시사점**: Figma가 MCP를 공식 채택. 우리도 Figma MCP 호환 레이어(M3)의 가치가 확인됨.

### 3. Claude Design (2026.04.17 출시)
- Anthropic의 독립 비주얼 워크 제품
- 디자인, 프로토타입, 슬라이드, 원페이저를 대화로 생성
- **한계**: 세밀한 조작, 공유 디자인 시스템, 개발 핸드오프, 실시간 협업, 버전 관리 부족

### 4. Opus 4.6/4.7
- 복잡한 인터랙티브 앱, 데이터 밀집 인터페이스 생성 개선
- Figma Make 프로토타입 품질 향상

---

## 여전히 해결 안 된 커뮤니티 불만 (2026.07 기준)

| 불만 | 출처 | teguma 해결 여부 |
|------|------|:---:|
| 기존 복잡한 파일에서 컴포넌트 로직 오해 | Reddit r/UXDesign | ✅ get_design_context가 구조화된 컨텍스트 제공 |
| 픽셀 퍼펙트 신뢰성 부족 (간격 에러, 할루시네이션 레이어) | Figma 포럼 | ✅ get_constraints의 MUST/MUST NOT 가드레일 |
| 코멘트/어노테이션 MCP 접근 불가 | Figma 포럼 | 🔜 미구현 (M4+) |
| 높은 토큰 소모, 긴 MCP 호출 시간 | Figma 포럼 | ✅ 압축 표현으로 1/10 절감 |
| 인증 문제, 누락된 도구 | Figma 포럼 | ✅ check_connection으로 진단 |
| 디자인 시스템 변수/네이밍 체계 오해 | Reddit | ✅ get_tokens가 정확한 토큰 전달 |

---

## teguma 포지셔닝 업데이트

Figma가 자체 에이전트 + MCP를 강화하면서 "Figma 대체" 포지셔닝은 약해짐.
대신 **오픈소스 + 셀프호스트 + 브랜드 컨텍스트 자동화** 니치가 명확해짐:

1. **Figma를 쓸 수 없는 팀** (예산, 보안, 셀프호스트 요구) → Penpot + teguma
2. **Figma를 쓰지만 AI 연동이 불만인 팀** → teguma의 Figma MCP 호환 레이어 (M3)
3. **AI 에이전트 워크플로 최적화** → teguma의 압축 컨텍스트 + 가드레일

Figma의 공식 MCP는 "Figma 생태계 잠금"을 강화하는 방향.
teguma는 "어떤 디자인 도구를 쓰든 AI가 브랜드를 이해하게" 하는 방향.

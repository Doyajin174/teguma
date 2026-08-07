# Shooble Business 원고 생성·편집 화면 UX 조사

- 조사일: 2026-08-02
- 대상: Business Shooble의 `프롬프트 입력 후 → 조사 → 원고 생성 → 편집` 구간
- 상태: 제품 시안 반영 전의 조사 초안
- 주의: 이 문서는 실제 사용자 테스트 결과가 아니다. 제품 문서, 공개 화면 레퍼런스, HCI/접근성 연구를 분리해 읽고, Shooble에 적용하는 부분은 명시적으로 추론했다.

## 1. 조사 결론

앞선 3분 수준의 확인만으로는 부족했다. 당시에는 10건 이상의 구조화된 레퍼런스 목록과 정보량·인지부하에 관한 근거 묶음이 없었기 때문에, 그 상태의 시안을 “조사된 디자인”이라고 부를 수 없었다.

이번 조사에서는 다음을 확보했다.

- 문서 작성·AI 작업공간·디자인 캔버스 계열의 제품/시스템 레퍼런스 12건 이상
- 점진적 공개, 시각적 계층, 시스템 상태, 인지부하, 선택 과부하, 중단 비용, AI 투명성에 관한 HCI 근거 10건 이상
- WCAG, W3C Design Tokens, Atlassian, USWDS, GOV.UK의 일관성·접근성·콘텐츠 구조 원칙
- Shooble에 바로 적용할 수 있는 정보 우선순위와 생성 단계별 공개 범위

핵심 결론은 “정보를 많이 보여주는 생성 화면”이 아니다.

> 생성 중에는 사용자가 지금 무엇을 기다리는지, 실제로 무엇이 확인됐는지, 원고가 어느 정도 도착했는지만 한눈에 이해해야 한다. 상세 근거는 필요할 때 열 수 있어야 하지만, 기본 화면이 조사 로그·편집 도구·상태 메타데이터로 채워져서는 안 된다.

## 2. 제품·화면 레퍼런스

아래 레퍼런스는 모두 같은 종류의 제품이 아니다. 문서 편집기는 캔버스와 도구 배치를, AI 작업공간은 생성 결과와 검토 경계를, 디자인 시스템은 일관성과 접근성을 참고하기 위해 나눠 사용했다.

| 레퍼런스 | 확인한 구조 | Shooble에 적용할 점 |
| --- | --- | --- |
| [Naver SmartEditor ONE](https://smarteditor.naver.com/) | 네이버 블로그 작성에 최적화된 문서 중심 편집 경험 | 익숙한 흰 문서 캔버스와 제목→본문 진입 순서 |
| [Naver SmartEditor ONE Desktop 기능](https://smarteditor.naver.com/desktop/features.html) | 상단 도구, 편집 캔버스, 선택적 부가 영역의 분리 | 편집이 시작된 뒤에만 상세 도구를 노출하고 생성 중에는 숨김 |
| [Naver SmartEditor2](https://github.com/naver/smarteditor2) / [공식 데모](https://naver.github.io/smarteditor2/demo/) | WYSIWYG·HTML·TEXT 모드, 포맷 도구, 키보드 접근성 | 기존 편집 코어를 유지하되 생성 화면과 편집 화면의 책임을 분리 |
| [Google Docs](https://support.google.com/docs/) | 제목·문서 상단·도구 모음·중앙 문서·저장 상태의 계층 | 문서가 주인공이고 상태는 보조 정보로 남기는 구성 |
| [Word for the web: Simplified ribbon](https://support.microsoft.com/en-US/Word/using-the-simplified-ribbon-in-word-for-the-web) | 기본 리본을 한 줄로 줄이고 보조 명령을 검색·더보기·확장으로 이동 | “모든 기능을 처음부터 보여주기” 대신 단계별 도구 공개 |
| [Confluence Cloud 편집·게시](https://support.atlassian.com/confluence-cloud/docs/create-edit-and-publish-a-page/) | 초안·자동 저장·버전 이력과 별도의 게시 행동 | 원고 완성·자동 저장·발행 설정을 명확히 분리 |
| [Confluence Rovo 콘텐츠 생성](https://support.atlassian.com/confluence-cloud/docs/create-and-edit-content/) | AI가 초안을 만들고 사용자가 미리보기·편집 후 문서에 반영 | AI 결과를 바로 게시하지 않고 검토 가능한 초안으로 취급 |
| [Microsoft Loop](https://support.microsoft.com/en-US/Loop/get-started-with-microsoft-loop) | 작업공간과 문서형 캔버스, 재사용 가능한 컴포넌트 | 긴 작업을 한 화면에서 이어가되 핵심 캔버스의 집중 유지 |
| [Microsoft Copilot Pages](https://support.microsoft.com/en-US/Microsoft-365-Copilot/collaborate-with-your-team-on-a-microsoft-365-copilot-page) | Copilot 응답을 편집 가능한 페이지로 옮기고 선택 영역에서 도구 노출 | 생성 결과와 편집 행동을 같은 문서 위치에서 자연스럽게 이어가기 |
| [Figma 파일 탐색 구조](https://help.figma.com/hc/en-us/articles/15297425105303-Explore-design-files) | 툴바·좌측/우측 사이드바·중앙 캔버스의 역할 분리 | 캔버스와 주변 도구의 시각적 위계를 명확하게 유지 |
| [Figma 툴바](https://help.figma.com/hc/en-us/articles/360041064174-Access-design-tools-from-the-toolbar) | 캔버스 작업을 위한 도구를 한 곳에 모으되 작업 맥락에 따라 사용 | 생성 중에는 조작 도구를 비활성화하고 편집 시점에만 활성화 |
| [Craft 스타일링](https://support.craft.do/en/write-and-edit/styling) | 문서·페이지 수준 스타일, 선택적 삽입/스타일 패널 | 문서 자체는 단순하게, 상세 스타일은 인스펙터로 이동 |
| [Notion 콘텐츠 스타일링](https://www.notion.com/help/customize-and-style-your-content) | 문서 페이지 중심, 필요 시 스타일 메뉴와 확장 옵션 | 문서 본문을 기본값으로 두고 부가 설정은 보조 레이어로 유지 |
| [Atlassian Design System](https://atlassian.design/foundations) | 토큰을 색·간격·타이포그래피·아이콘·경계의 단일 기준으로 사용 | 화면별 임의 스타일을 만들지 않고 상태·간격·타입 토큰을 공유 |
| [USWDS](https://designsystem.digital.gov/) / [GOV.UK Design System](https://design-system.service.gov.uk/) | 사용자 과업 중심의 구성, 접근성, 검증된 패턴 | 내부 용어가 아니라 사용자가 이해하는 행동·상태로 라벨링 |

### 레퍼런스에서 공통으로 보인 패턴

1. 문서형 제품은 중앙 캔버스가 가장 큰 시각적 면적을 차지한다.
2. 도구가 많아도 기본 상태에서 모든 도구를 같은 강도로 노출하지 않는다.
3. AI 결과는 초안·미리보기·검토 단계를 거치며, 자동 발행과 동일시하지 않는다.
4. 상태·저장·게시 같은 신뢰 정보는 숨기지 않지만, 원고 자체보다 커지지 않는다.
5. 좌우 패널은 고정된 정보의 본문이 아니라 맥락에 따라 열고 닫는 보조 영역이다.

## 3. 인간 인지·HCI 조사

### 3.1 정보량과 시선의 우선순위

- [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)는 보조 정보를 처음부터 모두 보여주기보다 사용자가 필요할 때 공개하면 우선순위 판단, 학습성, 효율, 오류 측면에 도움이 된다고 설명한다. 따라서 생성 중 화면에는 핵심 상태 한 줄을 두고 상세 조사 내역을 `진행 정보`로 접는 방향이 근거와 맞는다.
- [NN/G Visual Design Principles](https://media.nngroup.com/media/articles/attachments/Principles_Visual_Design-Letter.pdf)는 크기·색·배치가 시각적 순위를 만들며, 타입 크기를 과도하게 늘리지 않고 대비와 여백으로 계층을 만들어야 한다고 정리한다.
- [NN/G Recognition Rather Than Recall](https://media.nngroup.com/media/articles/attachments/Heuristic_6_A4_compressed.pdf)은 사용자가 기억해 두지 않아도 관련 정보를 눈앞에서 인식할 수 있어야 한다고 본다. 조사 화면에서는 현재 검색어와 현재 확인 상태를 보여주되, 내부 이벤트명이나 원시 도구 결과를 노출하지 않는 것이 맞다.
- [NN/G Match Between System and the Real World](https://media.nngroup.com/media/articles/attachments/Heuristic_2_Letter_compressed.pdf)는 시스템 내부 용어보다 사용자의 언어와 자연스러운 순서를 사용하라고 권한다. `reference-page-collected` 같은 내부 명칭이 아니라 `공식 소개 페이지 확인됨`처럼 써야 한다.
- [NN/G F-shaped Reading Pattern](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/)은 웹 사용자가 상단과 왼쪽을 먼저 훑고, 긴 문장을 끝까지 읽기보다 제목·소제목·짧은 문단을 통해 내용을 스캔한다고 설명한다. 화면 상단에는 작업명과 현재 상태만, 원고에는 제목·소제목·짧은 문단 순서를 유지해야 한다.

이 연구들은 “화면에는 정확히 몇 개의 항목만 있어야 한다”는 보편 숫자를 제공하지 않는다. 화면 크기, 과업, 사용자의 숙련도, 항목의 의미가 함께 작용한다. 따라서 Shooble의 기준은 고정된 카드 개수가 아니라 시각적 우선순위다.

### 3.2 기다림·진행·주의 전환

- [NN/G Visibility of System Status](https://media.nngroup.com/media/articles/attachments/Heuristic_1_compressed.pdf)는 시스템이 무엇을 하고 있는지 빠르고 이해 가능한 피드백으로 알려야 신뢰가 생긴다고 한다. 스피너 하나 대신 실제 검색어, 실제 확인된 페이지, 실제 도착한 원고 조각을 보여주는 이유다.
- [NN/G Animation Usability](https://www.nngroup.com/articles/animation-usability/)는 애니메이션이 상태의 원인과 결과를 이해하는 데 도움을 줄 때 유용하지만, 반복 애니메이션이 사용자의 주의를 붙잡아 오히려 방해가 될 수 있다고 설명한다. 따라서 가짜 타이핑, 타자음, 계속 움직이는 장식은 배제한다.
- [NN/G iPad Usability Report](https://media.nngroup.com/media/reports/free/iPad_App_and_Website_Usability_2nd_Edition.pdf)는 긴 빈 스피너보다 정확한 진행 정보나 현재까지 내려온 콘텐츠를 보여주는 편이 낫다고 관찰한다. 다만 이 자료의 특정 시간 수치는 보편 법칙으로 사용하지 않는다.
- [Task interruption eye-tracking study](https://www.sciencedirect.com/science/article/pii/S0141938226002817)는 중단이 있는 조건에서 오류·총 작업 시간·시선 방문 횟수가 증가한 결과를 보고한다. 생성 중 도구 패널이 계속 열리고 닫히거나 자동으로 화면 위치를 바꾸면 사용자의 작업 기억과 시선이 분산될 수 있으므로, 문서 위치와 상태 영역을 안정적으로 유지해야 한다.
- [GOV.UK question-page pattern](https://design-system.service.gov.uk/patterns/question-pages/)은 단계 표시가 항상 이로운 것이 아니며, 조사로 도움이 확인될 때만 단순하게 사용하라고 한다. Shooble의 `자료 확인 → 초안 작성 → 정리`도 사용자가 현재 위치를 이해할 만큼만 남기고, 진행 단계를 장식적인 대시보드로 키우지 않는다.

### 3.3 선택 과부하와 정보 과잉에 대한 주의

- [Choice overload meta-analysis](https://doi.org/10.1086/651235)는 50개 연구·63개 조건을 분석했지만 평균적으로 선택지가 많을수록 항상 나쁜 결과가 나오는 것은 아니며 맥락에 따라 효과가 크게 달라진다고 보고한다. 그러므로 “정보가 많으면 무조건 나쁘다”가 아니라 “현재 과업에 필요 없는 정보가 주목을 경쟁하면 나쁘다”로 해석한다.
- [Cognitive workload in HCI survey](https://doi.org/10.1145/3582272)는 시각적 복잡성을 과업에 필요한 항목과 맥락만 보여주는 방식으로 줄일 수 있다고 정리한다. 이는 생성 중 편집 도구·발행 도구·자료 로그를 동시에 펼치지 않는 근거가 된다.
- 최근의 [information overload·visual attention 연구](https://www.sciencedirect.com/org/science/article/abs/pii/S0736376126000182)는 고·저 정보량 조건에서 시선, 생리적 각성, 인지 노력, 선호를 함께 살핀다. 표본과 맥락이 제한된 최신 연구이므로 일반 법칙이 아니라 후속 사용자 테스트에서 측정할 변수로 취급한다.

### 3.4 AI 투명성·사용자 통제

- 최근 CHI 연구인 [Dynamic Transparency Needs in Multi-Agent Systems](https://doi.org/10.1145/3772318.3791157)는 설명을 모두 펼쳐 놓는 것보다 사용자가 필요할 때 열 수 있는 조절 가능한 상세도가 상황에 맞다고 보고한다. Shooble의 조사 상세는 기본 접힘, 핵심 결과는 기본 노출로 두는 이유다.
- [GUI Agents and Dark Patterns 연구](https://doi.org/10.1145/3772318.3791568)는 불투명한 에이전트 UI가 사용자의 주의를 좁히고 인지부하와 통제감에 악영향을 주어 근거 없는 승인으로 이어질 수 있음을 경고한다. Shooble은 사용자를 몰래 조종하는 방향이 아니라, 무엇을 확인했고 무엇을 확인하지 못했는지 드러내 사용자의 판단을 돕는 방향으로 설계해야 한다.
- [JCMC의 AI 투명성 연구](https://academic.oup.com/jcmc/article/26/6/384/6367958)와 [최근 AI 상호작용 연구](https://pubmed.ncbi.nlm.nih.gov/42352790/)는 설명·출처·사용자 통제가 신뢰와 불확실성 인식에 영향을 준다고 본다. 단, 출처를 보여준다는 이유만으로 생성 결과가 사실이라고 보증해서는 안 된다.

## 4. 일관성·접근성·최신 제품 경향

### 일관성

- [Atlassian Typography](https://atlassian.design/foundations/typography/applying-typography)는 토큰과 명확한 제목 계층을 사용하고, 긴 본문은 읽기 가능한 크기를 유지할 것을 권한다. Shooble은 생성 화면과 편집 화면에서 제목·소제목·본문의 의미와 크기 관계를 바꾸지 않는다.
- [Atlassian Grid and Spacing](https://atlassian.design/foundations/grid-beta/applying-grid)은 8px 기반 단위와 제한된 간격 스케일을 사용해 밀도와 리듬을 일관되게 유지한다. 화면마다 임의의 간격을 만들지 않는다.
- [W3C Design Tokens Community Group](https://www.w3.org/community/design-tokens/)는 색·크기·타이포그래피 같은 디자인 결정을 여러 플랫폼에서 공유 가능한 토큰으로 관리하는 방향을 표준화하고 있다. Business 상태점, 경고, 성공, 비활성의 색과 의미를 토큰으로 고정한다.

### 접근성과 움직임

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)는 제목·레이블·초점·탐색 위치·대상 크기·애니메이션·시간 제한을 함께 다룬다. 생성 중에는 읽기 전용이더라도 취소, 진행 정보, 편집 전환의 키보드 접근성과 명확한 포커스를 보장해야 한다.
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)는 사용자가 움직임 감소를 요청하면 비필수 애니메이션을 줄이거나 제거해야 한다고 설명한다. 실제 수신 조각은 유지하되, reduced-motion에서는 한 글자씩 드러내는 효과 대신 문장·문단 단위 갱신으로 바꾼다.

### 최신 AI 작업공간의 공통 경향

공개 제품 문서와 최근 연구를 종합하면, 2026년형 AI 작성 화면의 유의미한 경향은 “화려한 AI 연출”이 아니라 다음에 가깝다.

1. 결과가 생기는 동안 사용자가 확인할 수 있는 실제 근거·출처·진행 상태를 제공한다.
2. 생성 결과는 바로 게시되는 답변이 아니라 검토·편집 가능한 초안으로 다룬다.
3. 상세 설명·도구·메타데이터는 필요할 때 열 수 있도록 한다.
4. 인간이 중단·수정·재시도·승인을 명시적으로 통제한다.
5. 문서·상태·도구의 시각적 역할을 토큰과 패턴으로 일관되게 유지한다.

이것은 “최신 디자인은 반드시 이 형태”라는 법칙이 아니다. 제품의 과업과 사용자 테스트로 확인해야 하는 현재의 설계 방향이다.

## 5. Shooble에 적용할 제품 규칙

### 생성 중

1. **첫 화면부터 흰 문서 캔버스를 연다.** 빈 상태를 별도 로딩 카드로 가리지 않는다.
2. **상단에는 작업명·취소·핵심 상태만 둔다.** 내부 실행 ID, 모델명, 단계별 이벤트 수, 기술 용어는 기본 노출하지 않는다.
3. **조사는 한 줄로 요약한다.** 예: `자료 확인 중 · 세바사 공식 제품 서비스 · SEVASA Landing 확인됨`.
4. **실제 검색·페이지·원고가 도착할 때만 갱신한다.** 데이터가 없을 때 작성되는 척하지 않는다.
5. **상세 조사 내역은 하나의 접힌 disclosure로 둔다.** 기본 화면에 검색·확인·원고·진단 카드를 병렬로 늘어놓지 않는다.
6. **원고는 실제 도착한 범위만 제목→소제목→문단 순서로 표시한다.** commentary·reasoning·raw JSON·도구 원문은 문서에 들어오지 않는다.
7. **생성 중에는 편집 툴바와 발행 도구를 숨긴다.** 생성 화면에서 사용자가 해야 할 일은 읽고 기다리거나 취소하는 것이기 때문이다.
8. **자동 스크롤은 사용자가 위로 이동하면 멈춘다.** 위치를 강제로 빼앗지 않는다.

### 생성 완료·편집 전환

1. 검증된 PostDraft가 준비된 뒤에만 `원고 완성`과 `편집 시작`을 보여준다.
2. final-only로 끝나 실제 partial이 없었다면 이를 live 생성 성공으로 꾸미지 않고 `생성 완료 · 편집 전` 상태로 둔다.
3. 편집 시작을 누르면 같은 캔버스 위치에서 SmartEditor형 도구 모음과 우측 인스펙터를 단계적으로 연다.
4. 자료 부족은 실패 문구 하나로 끝내지 않고 실제 확인 자료, 부족한 정보, `자료 다시 찾기`를 보여준다. 자료가 없는데 `확인된 자료만으로 계속`을 활성화하지 않는다.

### 권장 정보 계층

기본 화면의 시선 순서는 다음 하나로 고정한다.

`원고 캔버스` → `현재 상태 한 줄` → `다음 행동 하나` → `상세 조사 disclosure`

이를 “항상 네 개의 UI만 보여야 한다”는 과학적 숫자로 오해하면 안 된다. 생성 중 과업에 필요한 우선순위를 정하는 제품 규칙이다.

## 6. 실제 사용자 테스트에서 확인할 것

이번 조사는 사용자 테스트를 대신하지 않는다. 다음 시안부터는 같은 화면을 최소한 아래 세 변형으로 비교해야 한다.

- A: 현재처럼 문서 + 핵심 상태 한 줄
- B: 문서 + 핵심 상태 + 열린 조사 상세
- C: 도구·상태·자료 카드를 동시에 보여주는 기존 고밀도안

측정 항목:

- 사용자가 첫 시선에서 원고가 생성 중임을 알아차리는 시간
- 현재 무엇을 하고 있는지와 다음에 할 일을 말할 수 있을 때까지의 시간
- 화면의 서로 다른 영역을 오가는 시선/클릭 횟수
- 취소·다시 확인·편집 시작을 잘못 누른 횟수
- 자료 부족 뒤 회복 성공률과 소요 시간
- 작업 후 주관적 정신적 노력(NASA-TLX 또는 짧은 단일 문항)
- 결과를 믿을 수 있다고 느낀 정도와 확인한 근거를 기억하는 정도

처음부터 “몇 개 이상이면 피곤하다”는 임계값을 발명하지 않는다. 데이터가 쌓이기 전에는 `원고 하나 + 핵심 상태 한 줄 + 선택적 상세 하나`를 기본 가설로 삼고, 실제 사용 결과로 조정한다.

## 7. 아직 모르는 것

- 위 레퍼런스가 Shooble의 실제 고객에게 최적이라는 증거는 아직 없다.
- 정보량과 피로감은 화면 크기, 과업 긴급성, 사용자 숙련도, 자료의 중요도에 따라 달라진다.
- AI 조사 과정을 얼마나 자세히 보여줘야 신뢰가 가장 높아지는지에 대한 Shooble 자체 데이터는 없다.
- 실제 provider가 매번 partial delivery를 보장하지 않는다면, 가짜 타이핑으로 빈 구간을 메우면 안 된다.
- 따라서 이 문서의 규칙은 근거 기반의 설계 가설이며, 다음 시안과 짧은 사용성 비교로 검증해야 한다.

## 8. 현재 시안에 대한 판정

`prompt-after-submit-v2.html`은 이전의 툴바·메타데이터 과밀을 줄인 잠정 시안이다. 방향은 다음 조사 결론과 맞지만, 아직 최종 디자인으로 판정하지 않는다.

- 유지: 중앙 흰 문서, 실제 원고 조각, 한 줄 상태, 상세 정보의 접힘
- 재검토: 상태 한 줄의 문장 길이, 자료 확인과 원고의 시선 연결, 편집 전환 순간의 안내
- 금지: 생성 중 전체 SmartEditor 툴바 복원, 조사 이벤트 전부 펼치기, 가짜 타이핑, 내부 ID·원시 이벤트 노출

다음 시안은 이 조사 결과를 기준으로 `생성 직후의 첫 화면`과 `실제 자료가 도착한 뒤의 화면`을 한 프레임 안에서 비교할 수 있게 만든다.

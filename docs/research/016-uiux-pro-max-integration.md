# UI/UX Pro Max 스킬과 디자인 QA 게이트 연동 조사

> 작성일: 2026-08-08
> 관련 이슈: [#24](https://github.com/Doyajin174/teguma/issues/24)

## 결론

`ui-ux-pro-max`는 런타임 라이브러리가 아니라 로컬 CSV 지식 베이스와 Python 검색 도구다. 따라서 teguma는 이 디렉터리에 런타임 의존하지 않고, POC에서 필요한 규칙만 명시적으로 옮겨 결정론적으로 검사해야 한다. 기존 `src/design/qa.ts`의 기하·텍스트 적합·4.5:1 대비 검사는 유지하고, 스킬 지식은 **프로필 선택 근거와 추가 검사 기준**으로 쓴다.

색상 대비와 타이포 스케일은 현재 문서 모델에서 재현 가능하다. 반면 팔레트 데이터에는 색상 조화 점수나 허용 오차가 없으므로, 이를 주관적 "조화 점수"로 주장하면 안 된다. POC의 팔레트 검사는 선택한 프로필의 역할 색상과 실제 사용 색상을 비교하는 일관성 검사로 한정한다.

## 로컬 스킬 구조

경로: `/Users/hyenjinkang/.codex/skills/ui-ux-pro-max/` (읽기 전용으로 조사)

| 경로 | 역할 |
|---|---|
| `SKILL.md` | 우선순위, 도메인, 검색·디자인 시스템 생성 절차 |
| `data/colors.csv` | 제품 유형별 역할 기반 색상 팔레트 192행 |
| `data/typography.csv` | 헤딩/본문 글꼴 조합 74행 |
| `data/ux-guidelines.csv` | 규칙·Do/Don't·심각도 99행 |
| `data/styles.csv`, `products.csv`, `ui-reasoning.csv` | 스타일·제품 분류와 디자인 시스템 추천 보조 데이터 |
| `scripts/core.py` | 표준 라이브러리만 쓰는 CSV 로더와 BM25 검색 |
| `scripts/search.py` | CLI와 JSON 출력, `--design-system` 조합 출력 |
| `references/quick-reference.md` | 우선순위별 규칙 원문 |

스킬 소개의 "98 UX 가이드라인"과 실제 `ux-guidelines.csv`의 데이터 행 수(99)는 다르다. 구현 기준은 소개 숫자가 아니라 커밋 시점에 고정한 입력 행과 선택 규칙 ID여야 한다.

### 데이터 스키마와 적용 가능성

| 데이터 | 주요 열 | teguma 적용 |
|---|---|---|
| 팔레트 | `Product Type`, `Primary`, `On Primary`, `Secondary`, `On Secondary`, `Accent`, `On Accent`, `Background`, `Foreground`, `Card`, `Card Foreground`, `Muted`, `Muted Foreground`, `Border`, `Destructive`, `On Destructive`, `Ring`, `Notes` | 페이지 배경·사각형 fill·텍스트 색상을 역할 쌍으로 검사하고, 허용 팔레트 밖의 색상을 보고 |
| 폰트 페어링 | `Font Pairing Name`, `Heading Font`, `Body Font`, `Mood/Style Keywords`, `Best For`, `Notes` 등 | 텍스트 레이어의 `fontFamily`, `fontWeight`, `fontSize`, `lineHeight`를 선택 조합·스케일과 비교 |
| UX 가이드라인 | `Category`, `Issue`, `Platform`, `Description`, `Do`, `Don't`, `Code Example Good/Bad`, `Severity` | 구현 가능한 문서 레이어 규칙만 결정적 검사로 채택. 예: 대비, 본문 최소 크기, 행간, 색상만으로 의미 전달하지 않기 |

`quick-reference.md`는 정상 텍스트 대비 4.5:1, 모바일 본문 최소 16px, 본문 행간 1.5–1.75, 예시 타입 스케일 `12/14/16/18/24/32`, 의미론적 색상 토큰을 제시한다. 이 중 문서 모델의 수치 필드로 직접 판정 가능한 항목만 POC에 넣는다.

### 검색 인터페이스

검색은 Python 3 표준 라이브러리 기반 BM25이며 외부 의존성이 없다. 프로젝트 경로가 아니라 스킬의 절대 경로로 실행한다.

```bash
python3 /Users/hyenjinkang/.codex/skills/ui-ux-pro-max/scripts/search.py \
  "SaaS dashboard" --domain color --json
python3 /Users/hyenjinkang/.codex/skills/ui-ux-pro-max/scripts/search.py \
  "modern professional" --domain typography --json
python3 /Users/hyenjinkang/.codex/skills/ui-ux-pro-max/scripts/search.py \
  "accessible contrast semantic colors" --domain ux --json
```

조사 실행에서 `color`는 `Micro SaaS` 등 역할 색상 레코드를, `typography`는 `Modern Professional` 및 `Korean Modern` 조합을, `ux`는 `Color Contrast`(정상 텍스트 4.5:1)를 반환했다. 검색 결과는 추천을 위한 입력이지, QA의 동적 런타임 입력이 아니다.

## 검증 보강

아래 값은 POC의 고정 입력 후보를 추측하지 않도록, 2026-08-08에 스킬 원본 CSV와 검색 CLI를 다시 대조한 결과다. CSV 경로는 모두 `/Users/hyenjinkang/.codex/skills/ui-ux-pro-max/data/`이다.

| 원본 | 실제 행 데이터 | POC에 쓰는 의미 |
|---|---|---|
| `colors.csv` | `Product Type=Micro SaaS`, `Primary=#6366F1`, `On Primary=#FFFFFF`, `Accent=#059669`, `Background=#F5F3FF`, `Foreground=#1E1B4B` | 페이지와 텍스트, primary/accent 표면과 그 위 텍스트의 역할 쌍 |
| `typography.csv` | `Font Pairing Name=Korean Modern`, `Heading Font=Noto Sans KR`, `Body Font=Noto Sans KR` | 한국어 POC의 헤딩·본문 허용 글꼴 |
| `ux-guidelines.csv` No. 36 | `Issue=Color Contrast`, `Do=Minimum 4.5:1 ratio for normal text`, `Severity=High` | 기존 4.5:1 대비 판정의 출처 |
| `ux-guidelines.csv` No. 72 | `Issue=Line Height`, `Do=Use 1.5-1.75 for body text`, `Severity=Medium` | 본문 행간 검사 범위 |
| `ux-guidelines.csv` No. 74 | `Issue=Font Size Scale`, `Code Example Good=Type scale (12 14 16 18 24 32)`, `Severity=Medium` | 허용 타입 스케일 |

실행 인용:

```bash
python3 /Users/hyenjinkang/.codex/skills/ui-ux-pro-max/scripts/search.py \
  "Micro SaaS" --domain color --json
# count: 3; 첫 결과의 Product Type은 Micro SaaS이며 위 colors.csv 행과 일치

python3 /Users/hyenjinkang/.codex/skills/ui-ux-pro-max/scripts/search.py \
  "Korean Modern" --domain typography --json
# count: 3; 첫 결과의 Heading Font/Body Font은 모두 Noto Sans KR
```

두 검색은 추천 결과를 확인하는 재현 절차일 뿐이다. 구현은 이 실행이나 CSV 경로에 의존하지 않고, 선택한 원본 행과 규칙을 저장소 안의 버전 고정 POC 입력으로 옮긴다.

## 기존 teguma와의 경계

`src/design/qa.ts`는 이미 모든 텍스트 레이어의 실제 알려진 배경을 분할 샘플링하고, 최악 대비가 4.5:1 미만이면 `text-contrast-at-least-4.5`를 실패시킨다. 이미지·불완전한 둥근 배경은 fail-closed 처리한다. 또한 `brand-kit-respected`는 브랜드 팔레트·폰트·굵기 위반을 검사한다.

그러므로 #24는 이 대비 알고리즘을 재작성하는 일이 아니다. 선택된 UI/UX 프로필에서 역할 쌍·폰트 조합·타입 스케일을 도출해 기존 보고서에 독립 체크를 더하는 일이다. 브랜드 키트가 있으면 그 값이 우선이며, 스킬 팔레트는 브랜드 색상을 대체하거나 자동 정규화하지 않는다.

## 외부 사례

- Adobe Research의 Agentic-DRS는 타이포그래피·색상 조화·정렬·간격 같은 축별 평가를 합쳐 실행 가능한 피드백을 만든다. Teguma도 하나의 미적 점수 대신 결정적 검사별 결과를 유지해야 한다. [Adobe Research, 2026](https://research.adobe.com/news/agentic-design-review-system-teaching-ai-to-review-graphic-designs-the-way-experts-do/)
- Figma의 AI Design QA는 간격·정렬·컴포넌트 사용·색상·타이포그래피 및 디자인 시스템 이탈을 개별적으로 점검한다. 이는 색상·타이포 규칙을 현재 QA 결과의 이름 있는 체크로 노출하는 방향과 맞는다. [Figma AI Design QA](https://www.figma.com/solutions/ai-design-qa-agent/)

두 사례 모두 자동화가 잘하는 객관적 불일치와 사람 판단이 필요한 미감/브랜드 감각을 분리한다는 점에서, POC는 수치·등록 값으로 재현 가능한 검사만 출고 게이트로 삼아야 한다.

## 후속 POC 범위

구체적 매핑과 재현 입력·기대 출력·완료 조건은 [QA 게이트 연동 명세](../specs/016-uiux-qa-gate.md)에 고정한다. 이 이슈의 현재 작업은 조사와 명세이며, `qa.ts` 변경이나 테스트 추가는 포함하지 않는다.

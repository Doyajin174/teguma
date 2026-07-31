# 회사 홍보 에디토리얼 v2 명세

> 상태: Implemented
>
> 작성일: 2026-07-31
>
> 관련 이슈: [#8](https://github.com/Doyajin174/teguma/issues/8)

## 목표

회사 홍보 테스트베드 v1의 메시지는 유지하되, AI 생성 광고에서 반복되는 네온·홀로그램·과도한 3D 광택·템플릿 타이포를 제거하고 실제 기업 현장을 기록한 에디토리얼 사진처럼 다시 제작한다.

v1은 회귀 비교와 provenance를 위해 수정하지 않는다.

## 시각 계약

- 배경: 자연광 또는 현실적인 실내 혼합광, 눈높이 35–50mm, 깊은 초점
- 장면: 실제 설치·사용 맥락 하나와 명확한 초점 하나
- 재질: 마모, 먼지, 케이블, 종이처럼 현실적인 작은 흔적 허용
- 금지: 네온, 광선, 홀로그램, floating UI, color wash, bokeh 과잉, cinematic grade
- 타이포: IBM Plex Sans KR Regular/SemiBold
- 그래픽: 불투명 면, 직선, 단일 강조색만 허용
- 금지 그래픽: SVG gradient/filter, drop shadow, text stroke, rounded pill

## 회사별 방향

| 회사 | 실제 맥락 | 편집 문법 |
|---|---|---|
| SEVASA | 사용감 있는 건물 주차장의 EV 충전 설비 | 좌측 오프화이트 field-note 패널 |
| 슈퍼쇼츠 | 소규모 작업실의 노트북·휴대전화·노트 | 자연스러운 빈 벽 위 직접 타이포 + 하단 스트랩 |
| 주식회사 로드맵 | 센서가 설치된 주차 시설과 빈 주차면 | 사진 위 불투명 dark report 패널 |

## 출력

- `output/sevasa.png`
- `output/supershorts.png`
- `output/roadmap.png`
- `output/contact-sheet.png`
- `output/comparison-v1-v2.png`
- `output/qa-report.json`

생성 직후 PNG와 프롬프트는 `stock/generated/company-promo-v2/`에 별도 보관한다.

## 자동 QA

- 모든 선언 영역이 캔버스와 안전영역 안에 있는가
- 텍스트와 주요 피사체가 겹치지 않는가
- 불투명 패널 또는 수동 검수한 자연 배경 위 핵심 텍스트 대비가 4.5:1 이상인가
- 헤드라인이 정확히 2줄이며 각 줄 13자 이하인가
- 최종 SVG에 금지 그래픽 문법이 없는가
- PNG가 1080×1080인가
- v1/v2 비교판이 생성되는가
- 원본 스톡의 바이트·해시·해상도와 파생 경로가 일치하는가

## 수동 QA

- 충전 케이블, 센서 브래킷, 차량 방향과 주차선이 물리적으로 가능한가
- 노트북·휴대전화·케이블이 실제 책상 위에서 사용할 수 있는 관계인가
- 읽을 수 없는 생성 글자나 우연한 브랜드 마크가 없는가
- 실제 사진이라고 허위 표시하지 않고 생성형 provenance가 유지되는가

## 의존성

- 기존 `@resvg/resvg-js`, `pngjs`, `zod`만 사용한다.
- IBM 공식 저장소의 IBM Plex Sans KR TTF 두 굵기와 각 폰트의 OFL 1.1을 함께 보관한다.
- 새 런타임 의존성은 추가하지 않는다.

## 완료 기준

- 배경 3장과 완성 시안 3장이 시각 검수를 통과한다.
- v1/v2 비교판에서 네온·홀로그램·과장된 타이포 감소가 명확하다.
- 스톡 검증, 렌더 QA, 전체 테스트와 빌드가 통과한다.
- 셀프 리뷰와 AI 리뷰 후 squash merge한다.

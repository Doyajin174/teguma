# 자동 홍보 크리에이티브 시스템 조사

> 작성일: 2026-07-31
> 관련 이슈: [#4](https://github.com/Doyajin174/teguma/issues/4)
> 범위: 사진 위에 로고·헤드라인·보조 문구를 배치하는 정사각형 회사 홍보 이미지

## 결론

Teguma가 따라야 할 구조는 **완성 이미지를 한 번에 생성하는 모델**이 아니라 다음과 같은 계층형 파이프라인이다.

```text
브랜드·카피 데이터
  → 배경 생성/선택
  → 피사체·비주목 영역 분석
  → 유사 템플릿 검색
  → 복수 레이아웃 생성
  → 정렬·겹침 보정
  → SVG/Penpot 레이어 렌더
  → 자동 QA + 사람 승인
```

생성 모델은 배경과 소재에만 사용한다. 회사명, 한글 카피, 로고는 별도 레이어로 유지해야 정확성·편집성·재현성을 확보할 수 있다. OpenCOLE도 배경·오브젝트·텍스트 레이어를 분리하고 그래픽 렌더러로 최종 이미지를 만드는 방식을 택한다.

## 우선 참고할 프로젝트와 논문

| 우선순위 | 프로젝트·논문 | 얻을 수 있는 것 | Teguma 적용 판단 |
|---|---|---|---|
| 1 | [OpenCOLE, CVPRW 2024](https://openaccess.thecvf.com/content/CVPR2024W/GDUG/html/Inoue_OpenCOLE_Towards_Reproducible_Automatic_Graphic_Design_Generation_CVPRW_2024_paper.html) / [코드](https://github.com/CyberAgentAILab/OpenCOLE) | 의도에서 배경·오브젝트·텍스트 레이어를 만들고 편집 가능한 결과를 렌더하는 공개 파이프라인 | 아키텍처 직접 참고. 저장소는 2026-07-04에 archived되어 의존성으로 채택하지 않음 |
| 2 | [Desigen, CVPR 2024](https://arxiv.org/abs/2403.09093) / [코드](https://github.com/whaohan/desigen) | 배경을 만들 때부터 텍스트가 들어갈 비주목 공간을 보존하고, 배경과 레이아웃을 반복 보정 | 이미지 생성 프롬프트에 명시적인 negative space를 예약하는 근거 |
| 3 | [PosterLayout, CVPR 2023](https://openaccess.thecvf.com/content/CVPR2023/papers/Hsu_PosterLayout_A_New_Benchmark_and_Approach_for_Content-Aware_Visual-Textual_Presentation_CVPR_2023_paper.pdf) / [코드](https://github.com/PKU-ICST-MIPL/PosterLayout-CVPR2023) | 비어 있지 않은 캔버스 위 텍스트·로고·받침 레이어를 배치하는 데이터와 평가 방식 | 피사체 안전영역, 텍스트/로고/underlay 슬롯 모델에 반영 |
| 4 | [RALF, CVPR 2024 Oral](https://udonda.github.io/RALF/) / [코드](https://github.com/CyberAgentAILab/RALF) | 입력 이미지와 비슷한 사례의 레이아웃을 검색해 생성기에 제공 | 템플릿 수가 늘어나면 업종·구도 임베딩 기반 검색에 적용. 저장소는 archived 상태라 참고용 |
| 5 | [LayoutPrompter, NeurIPS 2023](https://papers.nips.cc/paper_files/paper/2023/hash/88a129e44f25a571ae8b838057c46855-Abstract-Conference.html) / [코드](https://github.com/microsoft/LayoutGeneration/tree/main/LayoutPrompter) | 제약 직렬화, 동적 예시 선택, 여러 결과를 만든 뒤 랭킹 | `campaigns.json` 같은 구조화 입력과 best-of-N 생성 전략의 근거 |
| 6 | [PosterLlama, ECCV 2024](https://eccv.ecva.net/virtual/2024/poster/593) | 레이아웃을 HTML 코드로 표현해 언어 모델의 설계 지식을 사용 | Penpot/SVG로 컴파일 가능한 중간 표현 설계에 참고 |
| 7 | [LayoutRectifier, 2025](https://arxiv.org/abs/2508.11177) | 생성 뒤 그리드 정렬, 불필요한 겹침, 포함 관계를 최적화로 보정 | 모델보다 먼저 규칙 기반 rectifier를 구현하는 근거 |
| 8 | [LAION Aesthetic Predictor](https://github.com/LAION-AI/aesthetic-predictor), [MUSIQ](https://research.google/blog/musiq-assessing-image-aesthetic-and-technical-quality-with-multi-scale-transformers/) | 복수 배경/시안의 미적·기술적 품질 점수 | 후보 정렬의 보조 신호로만 사용. 카피 정확성이나 브랜드 적합성은 측정하지 못함 |

### 가벼운 오픈소스 구성요소

- [Satori](https://github.com/vercel/satori): 사용자 폰트와 텍스트 외곽선을 포함한 HTML/CSS → SVG.
- [resvg](https://github.com/linebender/resvg): 정적 SVG를 플랫폼 간 재현성 있게 PNG로 렌더.
- [smartcrop.js](https://github.com/jwagner/smartcrop.js): 별도 대형 모델 없이 주목 영역 기반 크롭을 수행하는 가벼운 시작점.
- [Segment Anything](https://github.com/facebookresearch/segment-anything): 제품·차량·인물 마스크가 필요한 경우의 고급 선택지.
- [Tesseract](https://github.com/tesseract-ocr/tesseract): 렌더 뒤 카피가 읽히는지 확인하는 OCR 회귀 테스트 후보.
- [Penpot Plugin API](https://doc.plugins.penpot.app/interfaces/Context): 텍스트·도형·이미지 레이어 생성과 미디어 업로드를 지원하므로 같은 중간 표현을 편집 가능한 Penpot 문서로 보낼 수 있음.

## 실무 팁

### 1. 배경 생성 때부터 글자 자리를 비워야 한다

완성 사진을 만든 뒤 억지로 글자를 얹으면 피사체와 충돌한다. Desigen처럼 생성 프롬프트에 `left 42% low-detail negative space`와 같은 공간 제약을 넣고, 결과 데이터에도 `subjectBounds`와 `textBounds`를 별도로 기록한다.

### 2. 한글은 이미지 모델에 맡기지 않는다

배경 프롬프트에는 글자·숫자·로고를 금지한다. 최종 카피는 OFL 폰트와 SVG `<text>`로 렌더한다. [W3C 한국어 조판 요구사항](https://w3c.github.io/klreq/)을 기준으로 줄바꿈과 문장부호 규칙을 별도 구현해야 한다.

이번 테스트에서도 `Do Hyeon` 폰트에 가운데점 글리프가 없어 `□`로 출력되는 문제가 시각 검수에서 발견됐다. 따라서 이후에는 렌더 전 폰트 글리프 커버리지 검사와 렌더 후 OCR 비교를 추가해야 한다.

### 3. 하나를 만들지 말고 여러 개를 만든 뒤 고른다

LayoutPrompter의 구조처럼 동일 카피로 레이아웃·크롭·강조색을 3~5개 만들고 다음 신호로 랭킹한다.

1. 텍스트/피사체 겹침과 안전 여백
2. 정렬 오차와 요소 간 불필요한 중첩
3. 텍스트 대비
4. 카피 OCR 일치
5. 이미지-브랜드 설명 CLIP 유사도
6. 미적 품질 점수

마지막 선택은 사람의 승인 데이터로 남겨 템플릿 검색 순위를 개선한다.

### 4. 학습 모델보다 검색과 보정이 먼저다

현재처럼 템플릿 수가 적을 때 RALF나 PosterLayout 모델을 곧바로 학습할 이유는 없다. 먼저 업종, 배경 밝기, 피사체 위치, 카피 길이를 메타데이터로 저장하고 가장 가까운 템플릿을 검색한 뒤 규칙 기반으로 보정한다. 승인 사례가 충분히 쌓인 후에만 학습 모델을 검토한다.

### 5. 평가를 한 점수로 합치지 않는다

미적 점수가 높아도 글자가 틀리거나 로고를 가리면 실패다. 다음 게이트는 독립적으로 모두 통과해야 한다.

- correctness: 카피·로고·회사 정보 일치
- legibility: 대비와 최소 글자 크기
- geometry: 안전영역·겹침·정렬
- relevance: 업종과 메시지의 시각적 일치
- rights: 사진·폰트·로고 출처 기록

## 테스트베드에 반영한 결정

- 배경 3개는 생성형 이미지로 만들되 텍스트·로고를 금지했다.
- 헤드라인은 두 줄, 줄당 13자 이하로 제한했다.
- 사진의 피사체를 오른쪽에 두고 왼쪽을 카피 안전영역으로 예약했다.
- 로고, 카피, 배지, 태그를 SVG 레이어로 유지했다.
- `@resvg/resvg-js`를 이용해 1080×1080 PNG를 결정론적으로 생성했다.
- 캔버스 경계, 피사체 겹침, 안전 여백, 핵심 대비, 최종 해상도를 자동 검사했다.
- 자동 점수만 신뢰하지 않고 실제 렌더를 시각 검수했다.

## 브랜드 사실 확인 출처

- SEVASA: 에너지·EV·AI 예측 통합 운영 및 공식 문구 — [공식 사이트](https://www.sevasa.co.kr/)
- 슈퍼쇼츠: 블로그 URL에서 대본·자막·목소리를 포함한 쇼츠를 평균 1분에 제작 — [공식 사이트](https://www.supershorts.co.kr/)
- 주식회사 로드맵: AI·LiDAR 스마트 주차와 도시 흐름 최적화 — [공식 회사 소개](https://roadmap.ne.kr/news/videos/company-introduction)

## 다음 연구 순서

1. Penpot 레이어에 `teguma.slot` 메타데이터를 저장하는 템플릿 규약
2. 사진 주목 영역·피사체 박스 자동 추출
3. 한글 의미 단위 줄바꿈과 글리프 커버리지 검사
4. 템플릿 임베딩 검색과 사용자 선택 로그
5. 3~5개 후보 생성 및 다중 게이트 랭킹

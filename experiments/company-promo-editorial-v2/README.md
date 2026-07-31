# 회사 홍보 에디토리얼 v2

회사 홍보 테스트베드 v1의 문구와 3개 회사를 유지하면서, 생성 이미지 특유의 네온·홀로그램·과도한 광택과 템플릿 타이포를 줄인 비교 실험이다.

## 방향

- 기술을 빛나는 추상 효과로 표현하지 않고 실제 설치·사용 현장을 보여준다.
- 사진은 자연스러운 눈높이, 현실적인 혼합광, 깊은 초점을 사용한다.
- 타이포는 IBM Plex Sans KR Regular/SemiBold만 사용한다.
- 그라디언트, 필터, 드롭섀도, 텍스트 외곽선, 둥근 필 태그를 사용하지 않는다.
- 생성 사실을 숨기지 않는다. 원본·프롬프트·해시·파생 관계는 [스톡 manifest](../../stock/generated/company-promo-v2/manifest.json)에 남긴다.

세부 조사 근거는 [리서치 문서](../../docs/research/008-less-ai-generated-visual-direction.md), 구현 계약은 [명세](../../docs/specs/006-human-editorial-promo-v2.md)에 있다.

## 실행

```bash
npm run testbed:promo:v2
npm run testbed:promo:v2:check
npm run stock:verify:v2
```

렌더러는 `campaigns.json`을 검증한 뒤 1080×1080 PNG 3장, 연락판, v1/v2 비교판, QA 리포트를 생성한다. `:check` 명령은 다시 렌더한 뒤 커밋된 결과와 차이가 없는지 확인한다. 편집 가능한 SVG도 함께 만들지만 빌드 산출물로 간주해 Git에는 넣지 않는다.

## 결과물

- `output/sevasa.png`
- `output/supershorts.png`
- `output/roadmap.png`
- `output/contact-sheet.png`
- `output/comparison-v1-v2.png`
- `output/qa-report.json`

## 폰트

[IBM Plex Sans KR](https://github.com/IBM/plex)의 공식 TTF를 사용한다. OFL 1.1 전문을 `assets/fonts/OFL.txt`에 함께 보관하며, 외부 공개 전에는 로고·문구·이미지에 대한 별도 캠페인 승인이 필요하다.

네이버 검색 결과처럼 104×104px로 축소되는 대표 이미지는 [네이버 실노출 썸네일 v3](../company-promo-naver-v3/README.md)에서 별도로 다룬다.

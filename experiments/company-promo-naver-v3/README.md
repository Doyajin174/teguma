# 네이버 실노출용 회사 홍보 썸네일 v3

SEVASA, 슈퍼쇼츠, 주식회사 로드맵의 대표 이미지를 네이버 검색 결과의 실제 약 104×104px 노출 크기에서 다시 설계한 테스트베드다.

v2가 본문 히어로와 브랜드 포스터에 초점을 맞췄다면, v3는 한 피사체와 한 문구만 남겨 진입 전 식별과 클릭 이유에 집중한다.

## 원칙

- 한 장면·한 피사체·한 문구
- 피사체 점유율 60–75%
- 한 줄 훅 12자 이하
- 1080px 원본에서 120px 글자 → 104px에서 약 11.5px
- 정보 오버레이 면적 18% 이하
- 1:1과 중앙 16:9 크롭 동시 대응
- 본문·목록·푸터·CTA·분할 사진 없음

근거는 [네이버 썸네일 조사](../../docs/research/011-naver-thumbnail-reference.md), 구현 계약은 [v3 명세](../../docs/specs/011-naver-thumbnail-v3.md)에 있다.

## 실행

```bash
npm run testbed:promo:v3
npm run testbed:promo:v3:check
npm run stock:verify:v3
```

## 결과물

- `output/sevasa.png`
- `output/supershorts.png`
- `output/roadmap.png`
- `output/*-104.png` — 검색 결과 실제 크기
- `output/contact-sheet.png`
- `output/search-preview-104.png`
- `output/homefeed-preview.png`
- `output/comparison-v2-v3-104.png`
- `output/qa-report.json`

생성 배경 원본과 프롬프트·해시·파생 관계는 [v3 스톡 manifest](../../stock/generated/company-promo-v3/manifest.json)에 보관한다.

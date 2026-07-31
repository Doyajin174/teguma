# 회사 홍보 썸네일 v3 생성 스톡

네이버 블로그 대표 이미지 v3를 위해 별도로 생성한 배경 원본 컬렉션이다. 각 PNG 원본은 수정하지 않고 보관하며, 렌더러가 쓰는 JPEG와 최종 합성 PNG는 `manifest.json`의 파생 관계로 연결한다.

- 생성형 이미지임을 숨기지 않는다.
- 원본 PNG에는 C2PA claim·signature payload가 내장되어 있다. 저장소에서는 인증서 체인을 독립 검증하지 않아 `embedded-unverified`로 기록한다.
- 저장소 sidecar는 내장 credential을 대체하지 않고 원본 해시·프롬프트·파생 관계를 보완한다.
- 외부 게시 전 상표·우연한 글자·기하 오류·사용 조건을 다시 검토한다.
- 프롬프트 전문은 [실험 프롬프트](../../../experiments/company-promo-naver-v3/PROMPTS.md)에 있다.

검증:

```bash
npm run stock:verify:v3
```

# 회사 홍보 에디토리얼 v2 생성 스톡

SEVASA, 슈퍼쇼츠, 주식회사 로드맵 홍보 시안 v2에 사용한 생성 직후 PNG 원본 3장과 저장소 측 provenance 기록이다.

## 원칙

- `originals/`는 생성 직후 원본을 변경하지 않고 보관한다.
- 프롬프트, 생성 시각, 원본 바이트 수, SHA-256, 파생 파일을 `manifest.json`에 기록한다.
- 합성 시안과 압축 JPEG는 파생물이며 원본을 대체하지 않는다.
- 원본 PNG에는 C2PA claim·signature payload가 내장되어 있다. 저장소에서는 인증서 체인의 유효성을 독립 검증하지 않으므로 `embedded-unverified`로 기록한다.
- 저장소 sidecar는 내장 credential을 대체하지 않고 원본 해시·프롬프트·파생 관계를 보완한다.
- 외부 캠페인 사용 전에는 OpenAI 이용 조건, 관련 법률, 회사 로고·문구·이미지 승인을 별도로 검토한다.

## 검증

```bash
npm run stock:verify:v2
```

검증기는 원본의 바이트 수, SHA-256, PNG 해상도, C2PA claim·signature payload, 생성형 디지털 출처 유형과 모든 파생 파일의 존재를 확인한다. C2PA 인증서 체인의 암호학적 유효성은 별도 검증 도구로 확인해야 한다.

편집 시안과 전체 프롬프트는 [에디토리얼 v2 테스트베드](../../../experiments/company-promo-editorial-v2/README.md)에서도 볼 수 있다.

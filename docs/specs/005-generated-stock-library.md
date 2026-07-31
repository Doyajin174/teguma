# 생성형 이미지 스톡 라이브러리 명세

> 상태: Implemented
>
> 작성일: 2026-07-31
>
> 관련 이슈: [#6](https://github.com/Doyajin174/teguma/issues/6)

## 목표

회사 홍보 썸네일 테스트베드에서 실제 사용한 생성 직후 PNG 3장을 렌더용 JPEG 및 합성 결과물과 분리해 재사용 가능한 스톡 자산으로 보관한다.

단순 파일 복사가 아니라 다음 질문에 저장소만으로 답할 수 있어야 한다.

- 어떤 도구와 프롬프트로 생성했는가?
- 원본 파일이 변경되지 않았는가?
- 어떤 파생 이미지에 사용됐는가?
- AI 생성물이며 내장 C2PA payload와 저장소의 검증 수준이 정확히 드러나는가?

## 조사와 결정

- [C2PA/CAI 시작 가이드](https://opensource.contentauthenticity.org/docs/getting-started/)는 자산의 생성·편집 이력과 content binding을 manifest로 연결한다.
- [C2PA actions 가이드](https://opensource.contentauthenticity.org/docs/manifest/writing/assertions-actions/)는 생성형 AI 결과를 `c2pa.created`와 `trainedAlgorithmicMedia`로 표현한다.
- [IPTC Photo Metadata](https://iptc.org/standards/photo-metadata/photo-metadata/)는 설명, 출처, 권리, 관리 정보를 파일 내부 또는 sidecar에 유지할 수 있다고 정의한다.

생성 직후 PNG에는 생성 도구가 넣은 C2PA claim·signature payload가 있다. 저장소는 그 payload와 원본 바이트를 보존하지만 인증서 체인을 독립 검증하지 않으므로 `embedded-unverified`로 표시한다. 저장소 내부 JSON sidecar는 C2PA manifest를 대체하지 않고 프롬프트·해시·파생 관계를 보완한다.

## 디렉터리 계약

```text
stock/generated/company-promo/
├── README.md
├── manifest.json
└── originals/
    ├── sevasa-ev-energy.png
    ├── supershorts-creator-studio.png
    └── roadmap-smart-parking.png
```

- `originals/`에는 생성 도구가 반환한 원본 픽셀만 저장한다.
- 리사이즈, 압축, 로고, 카피가 들어간 파일은 원본 폴더에 두지 않는다.
- 파생물은 복제하지 않고 `manifest.json`의 상대 경로로 연결한다.
- 원본 3장의 합계가 약 5.5MB이므로 현재는 Git LFS를 도입하지 않는다.

## Manifest 필수 필드

컬렉션 수준:

- 스키마 버전과 컬렉션 ID
- provenance 수준과 C2PA 서명 상태
- 생성 도구, 모델 공개 여부, 원본 세션 ID
- C2PA/IPTC 디지털 소스 유형

자산 수준:

- 안정적인 ID, 파일명, MIME, 바이트, 해상도, SHA-256
- 생성 시각과 생성 결과 식별자
- 제목, 설명, 검색 키워드
- 실제 생성 프롬프트
- 생성 action과 software agent
- 압축 배경 및 합성 썸네일의 파생 관계
- 권리 상태와 외부 게시 전 확인사항

## 검증

`npm run stock:verify`는 다음을 검사한다.

- manifest 스키마와 ID·경로·해시 중복
- 원본 경로가 컬렉션 밖으로 이탈하지 않는지
- 파생 경로가 저장소 밖으로 이탈하지 않는지
- 파일 바이트와 SHA-256 일치
- PNG MIME 및 실제 1254×1254 해상도
- 선언한 모든 파생 파일의 존재

## 권리와 한계

- 세 이미지는 생성형 AI로 만든 합성 자산이며 사진 촬영물로 표시하지 않는다.
- 프롬프트에서 로고, 상표, 읽을 수 있는 글자, 사람을 의도적으로 제외했다.
- AI 생성물의 저작권 성립 여부는 관할과 인간 기여도에 따라 달라질 수 있으므로 소유권을 단정하지 않는다.
- 외부 광고 게시 전에는 적용되는 OpenAI 이용조건, 현지 법, 브랜드 승인과 우연한 유사성을 다시 검토한다.
- 현재 JSON은 검증 가능한 저장소 sidecar이며, 원본의 내장 C2PA claim·signature 존재를 확인한다. 인증서 체인의 암호학적 유효성은 별도 C2PA 검증 도구의 책임이다.

## 완료 기준

- 원본 PNG 3장의 해시가 생성 결과와 일치한다.
- 프롬프트와 파생 관계가 manifest에 남는다.
- 자동 검증, 전체 테스트와 빌드가 통과한다.
- 셀프 리뷰와 AI 리뷰 후 squash merge한다.

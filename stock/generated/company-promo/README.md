# 생성형 회사 홍보 배경 스톡

회사 홍보 썸네일 테스트베드에 사용한 **생성 직후 원본 PNG** 컬렉션이다. 모든 이미지는 1254×1254이며 글자, 로고, 브랜드 마크를 후합성하기 전 상태다.

| 원본 | 용도 | 파생 렌더 |
|---|---|---|
| [sevasa-ev-energy.png](originals/sevasa-ev-energy.png) | EV 충전·에너지 관제 | [SEVASA 썸네일](../../../experiments/company-promo-testbed/output/sevasa.png) |
| [supershorts-creator-studio.png](originals/supershorts-creator-studio.png) | AI 쇼츠 제작·크리에이터 | [슈퍼쇼츠 썸네일](../../../experiments/company-promo-testbed/output/supershorts.png) |
| [roadmap-smart-parking.png](originals/roadmap-smart-parking.png) | AI·LiDAR 스마트 주차 | [로드맵 썸네일](../../../experiments/company-promo-testbed/output/roadmap.png) |

## 검증

저장소 루트에서 실행한다.

```bash
npm run stock:verify
```

검증기는 [manifest.json](manifest.json)에 선언한 SHA-256, 바이트, 해상도, 중복과 경로 안전성을 확인한다.

## Provenance 상태

- 디지털 소스 유형: `trainedAlgorithmicMedia`
- 생성 도구: OpenAI image generation through Codex
- 기록 방식: 저장소 내부 sidecar manifest
- C2PA 상태: **embedded-unverified** — 원본에 claim·signature payload가 있으나 이 저장소에서는 인증서 체인을 독립 검증하지 않음
- 프롬프트와 생성 결과 ID: `manifest.json`에 원문 보관

저장소 sidecar는 내장 C2PA 데이터를 대체하지 않고 원본 바이트·해시·프롬프트·파생 관계를 보완한다. 픽셀 원본에는 후처리를 하지 않는다. 리사이즈나 압축이 필요하면 새 파생물을 만들고 manifest에 관계를 추가한다.

## 사용 주의

프롬프트에서 제3자 로고, 읽을 수 있는 글자, 사람을 제외했지만 외부 게시 전에는 우연한 상표·제품·건축물 유사성을 시각 검수한다. AI 생성물의 권리 상태는 관할과 적용 약관에 따라 달라질 수 있으므로 이 컬렉션은 소유권을 단정하지 않는다.

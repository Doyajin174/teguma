# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- 회사 홍보용 정사각형 썸네일 3종 테스트베드
- SVG → PNG 결정론적 렌더러와 레이아웃·대비 자동 QA
- 자동 그래픽 디자인 프로젝트·논문 조사 문서
- 생성형 배경 원본 3종 스톡 라이브러리와 provenance manifest 검증
- AI 특유의 시각 단서를 줄인 다큐멘터리형 회사 홍보 시안 v2
- IBM Plex Sans KR 기반 절제된 편집 렌더러와 v1/v2 비교판
- 네이버 검색 104×104px 실노출에 맞춘 회사 홍보 썸네일 v3
- 1:1·104px·홈피드 중앙 크롭을 동시에 검증하는 노출 미리보기와 QA

### Fixed
- 생성 원본의 내장 C2PA claim·signature를 `embedded-unverified`로 정확히 기록하고 검증

## [0.2.0] - 2026-07-30

### Added
- `create_element`: Penpot 페이지에 도형/텍스트/보드 생성 (M2)
- `get_constraints`: 레이아웃 가드레일 MUST/MUST NOT 규칙 (M2)
- `get_page_layout`: 페이지 구조 트리 + 자동 힌트 (M2)
- `import_figma`: Figma REST API → Penpot 변환 (M3)
- FigmaClient: Figma REST API v1 클라이언트
- convertFigmaToPenpot: 구조 변환기 (Auto Layout→Flex, RGBA→hex, 노드 매핑)
- PenpotClient: 재시도 로직 (3회, 지수 백오프), 30s 타임아웃
- PenpotClient.commitChanges: 원자적 변경 커밋
- CLI: --help, --version, 도구 목록
- Dockerfile: 멀티스테이지 빌드
- CI: GitHub Actions (test + release on tag)
- 테스트 34개 (compressor 10 + tools 11 + converter 13)
- 비교 벤치마크 문서 (vs Figma+Claude Design)
- M3 Figma 파일 포맷 리서치

## [0.1.0] - 2026-07-30

### Added
- MCP 서버: Penpot 디자인 시스템 → AI 에이전트 브릿지
- `get_design_context`: 브랜드 컨텍스트 압축 추출
- `get_tokens`: 디자인 토큰 (색상/타이포/간격)
- `get_components`: 컴포넌트 목록 + 변형
- `get_constraints`: 레이아웃 가드레일 (MUST/MUST NOT)
- `create_element`: Penpot 페이지에 도형/텍스트 생성
- `list_files`: 접근 가능한 파일 목록
- Brand Context Compressor: 색상 역할 추론, 타이포 스케일, 간격 기반 단위 감지
- serializeForLLM: 토큰 효율적 텍스트 직렬화
- PenpotClient: HTTP RPC API, 재시도 로직 (3회, 지수 백오프)
- Dockerfile: 멀티스테이지 빌드
- CI: GitHub Actions (test + release)
- 단위 테스트 10개 (compressor)
- 리서치: Figma OSS 랜드스케이프, 커뮤니티 페인포인트, 비교 벤치마크

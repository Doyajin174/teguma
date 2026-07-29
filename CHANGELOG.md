# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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

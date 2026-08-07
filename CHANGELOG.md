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
- 미리캔버스 파리티 디자인 엔진: 선언형 다중 페이지 문서 모델과 스키마 검증
- 채널별 캔버스 사이즈 프리셋 14종 (네이버 블로그 3종 포함)
- 리사이즈 4-모드: 채우기·맞추기·원본·종횡비 재구성(`adapt`)
- 브랜드 키트 적용과 색상·폰트·로고 위반 리포트
- SVG·PNG·JPG·다중 페이지 PDF·편집 가능한 PPTX·GIF·MP4 내보내기 (PPTX는 고정 timestamp ZIP/PresentationML의 슬라이드 배경·텍스트·사각형·이미지 객체, JPG는 추가 의존성 없는 in-house baseline JPEG, 기본 quality 85의 4:4:4 chroma sampling, GIF는 최대 256색 결정론적 median-cut 팔레트·기본 100ms 지연·선택적 Floyd–Steinberg 디더링·10프레임·총 32,000,000 프레임 픽셀 상한, MP4는 기존 JPEG 인코더를 재사용한 결정론적 Motion JPEG ISO BMFF 컨테이너·기본 100ms·같은 프레임 상한)
- 등록 글꼴의 sfnt glyph advance 기반 텍스트 측정·줄바꿈과 자동 레이아웃: 41단계 글꼴 후보, 축소·안전영역 내 성장·요청 시 말줄임 정책
- 파라미터화된 원본 채널 템플릿 12종과 템플릿 생성 MCP 도구
- 안전영역을 지키는 불변 레이아웃 프리미티브(정렬·분배·측정 텍스트 스택·세로 리듬)와 `arrange_design_layers` MCP 도구
- 로컬 디자인 프로젝트의 원자 저장·로드·결정론 목록 및 QA 실패 DRAFT 저장
- 번들 IBM Plex Sans KR Regular·SemiBold 자동 해석, `onMissingFont` 정책, 시스템 글꼴 비활성화 렌더
- 자산·출력 루트 containment 강화, `adapt`의 전체 캔버스 풀블리드 배경·페이지별 중앙 정렬, 내보내기 리소스 제한(8,192px 축·1,600만px/페이지·10페이지·1,000레이어)
- PDF FlateDecode 이미지 스트림과 UTF-16BE 제목 메타데이터 인코딩
- 캔버스 이탈·안전영역·텍스트 대비·프레임 적합·완전 가림·브랜드 준수 자동 QA 게이트 (`enforceQa: false` 원시 렌더 opt-out)
- 워크스페이스 정책 게이트와 `check_design_policy`: NFKC 금지어·필수 문구, 승인 상태, 이미지·브랜드 색상·등록 프리셋·페이지 수 제한 검사와 출고 허용 여부
- `process_design_image`: 결정론적 crop·scale·단색 pad·단색 배경 flood fill 제거·투명 여백 trim, 축 8,192px·16,000,000px 제한
- 디자인 MCP 도구 12종: `list_size_presets`, `create_design_document`, `check_design_policy`, `create_from_template`, `autolayout_design_document`, `arrange_design_layers`, `resize_design_document`, `export_design_document`, `process_design_image`, `save_design_project`, `load_design_project`, `list_design_projects`
- 후속 범위: [#16](https://github.com/Doyajin174/teguma/issues/16) 템플릿 라이브러리의 선택적 추가 확장, [#18](https://github.com/Doyajin174/teguma/issues/18) 웹 에디터 UI

### Fixed
- 생성 원본의 내장 C2PA claim·signature를 `embedded-unverified`로 정확히 기록하고 검증
- 투명 PNG 내보내기에서 페이지 배경이 알파를 덮어쓰던 문제
- `adapt` 리사이즈에서 선언 프레임 높이 때문에 콘텐츠가 위로 치우치던 문제
- 리사이즈 오프셋이 라운딩 전 배율로 계산돼 보고값과 실제 좌표가 어긋나던 문제
- `fill`/`fit`의 부동소수점 경계에서 생기던 미세한 빈틈·초과와 퇴화 배율을 거부하도록 보정
- 부분 겹침을 페이지 배경으로 오판하던 텍스트 대비 검사를, 불투명도 합성과 둥근 모서리의 fail-closed 검사로 수정
- PDF 메타데이터의 비ASCII 문자열이 PDF 문법을 훼손할 수 있던 인코딩을 수정하고, export 경로의 symlink 경유를 directory inode 재검증·no-follow 독점 생성·link-count 검사로 완화
- 등록되지 않은 글꼴 fallback과 과도한 음수 `letterSpacing`이 실제 잉크보다 좁게 측정돼 텍스트 overflow를 QA가 통과시키던 문제
- PPTX가 슬라이드 페이지 배경을 기록하지 않아 변환 시 배경과 텍스트 대비가 손실되던 문제
- 정책 regex에서 bare `.` 와일드카드가 허용되던 문제를 allowlist 문법 검증으로 수정

## [0.4.0] - 2026-08-08
- chore: npm 퍼블리시 준비 — version 0.3.0, repository/files 필드
- fix: CLI 버전을 package.json에서 동적 로드
- chore: LICENSE (MIT) + CONTRIBUTING.md + .gitignore 보강
- chore: prepublishOnly 가드 (build+test before npm publish)
- feat: add company promo thumbnail testbed (#5)
- feat: archive generated image stock (#7)
- feat: add human editorial promo direction (#10)
- feat: add Naver-ready promo thumbnails (#12)
- feat: 미리캔버스 파리티 디자인 엔진 코어 (#20)
- chore: install repo-development-os thin routine
- docs: v0.1.0, v0.2.0 릴리스 리포트 추가
- feat: 웹 에디터 UI — 브라우저에서 디자인 엔진 직접 조작 (#21)
- docs: 미리캔버스 파리티 진행 상태 정리 문서
- docs: 주간 회고 폴더를 retrospectives로 통일
- docs(atlas): 코드 아틀라스 신규 생성
- docs: 디자인 시안(mockups)과 Shooble UX 리서치 추가, deploy 제외

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

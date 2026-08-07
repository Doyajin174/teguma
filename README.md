# teguma

**AI-native design bridge** — Penpot MCP + brand context engine.

Figma/Claude Design의 페인포인트를 오픈소스로 해결합니다. AI 에이전트가 브랜드 컨텍스트를 유지하면서 Penpot 디자인을 읽고 쓸 수 있게 하는 MCP 서버입니다.

## 왜 teguma?

| | Figma + Claude Design | Penpot 내장 MCP | **teguma** |
|---|---|---|---|
| 브라우저 필요 | ✅ | ✅ (플러그인) | ❌ |
| 디자인 시스템 임포트 | ❌ 토큰 파괴 | ⚠️ 수동 프롬프트 | ✅ 자동 압축 |
| 토큰 효율 | ❌ 전체 HTML | ⚠️ 중간 | ✅ 압축 표현 |
| 오픈소스 | ❌ | ✅ | ✅ |
| 셀프호스트 | ❌ | ✅ | ✅ |

## 빠른 시작

### 설치

```bash
npm install -g teguma
# 또는
npx teguma
```

### 설정

환경변수:

```bash
export PENPOT_URL=https://your-penpot-instance.com
export PENPOT_TOKEN=your-mcp-key
```

Penpot에서 MCP 키 발급: **계정 → Integrations → MCP Server → 키 생성**

### Claude Code / Cursor에서 사용

`.claude/settings.json` 또는 MCP 설정에 추가:

```json
{
  "mcpServers": {
    "teguma": {
      "command": "npx",
      "args": ["teguma"],
      "env": {
        "PENPOT_URL": "https://your-penpot.com",
        "PENPOT_TOKEN": "your-key"
      }
    }
  }
}
```

## MCP 도구

| 도구 | 설명 |
|------|------|
| `get_design_context` | 파일 전체 브랜드 컨텍스트 추출 (압축) |
| `get_tokens` | 디자인 토큰 (색상/타이포/간격) |
| `get_components` | 컴포넌트 목록 + 변형 |
| `list_files` | 접근 가능한 파일 목록 |
| `create_element` | Penpot 페이지에 도형·텍스트·보드·SVG 생성 |
| `get_constraints` | Penpot 레이아웃 가드레일 조회 |
| `get_page_layout` | Penpot 페이지 레이아웃 트리 조회 |
| `import_figma` | Figma 디자인 시스템을 Penpot으로 변환·가져오기 |
| `update_element` | Penpot 요소 속성 수정 |
| `delete_element` | Penpot 요소 삭제 |
| `check_connection` | Penpot 연결·인증 확인 |
| `list_size_presets` | 채널별 캔버스 사이즈 프리셋 14종 |
| `create_design_document` | 다중 페이지 문서 검증 + 자동 QA 리포트 |
| `check_design_policy` | 워크스페이스 정책 위반 목록과 출고 허용 여부 확인 |
| `create_from_template` | 12종 파라미터화된 채널 템플릿에서 문서·QA 생성 |
| `autolayout_design_document` | 텍스트 래핑·축소·안전영역 내 성장 또는 요청 시 말줄임 |
| `arrange_design_layers` | 선택 레이어 정렬·분배·측정 스택·세로 리듬 배치 |
| `resize_design_document` | 프리셋·수치 리사이즈 (fill/fit/original/adapt) |
| `export_design_document` | SVG / PNG / JPG / 다중 페이지 PDF / 편집 가능한 PPTX / GIF / MP4 내보내기 |
| `process_design_image` | 결정론적 crop·scale·pad·단색 배경 제거·투명 여백 trim |
| `save_design_project` | QA 상태를 함께 반환하며 로컬 DRAFT 프로젝트 저장 |
| `load_design_project` | 저장한 프로젝트 envelope 로드 |
| `list_design_projects` | 저장 프로젝트를 id 순서로 조회 |

총 23개 MCP 도구이며, 위 표의 디자인 엔진 도구는 12개다.

## 디자인 엔진

선언형 문서를 받아 채널별 사이즈로 리사이즈하고, 브랜드 키트를 적용하고, 검증한 뒤 내보내는 엔진입니다. Penpot 연결 없이도 동작합니다.

```bash
npm run design:demo          # 카드뉴스 3면 → PNG + PDF + 3개 채널 리사이즈
npm run design:gallery       # 12종 템플릿 PNG·104px 미리보기·리사이즈 비교·contact sheet
```

- **사이즈 프리셋** — 네이버 블로그 3종을 포함한 14종: 유튜브·인스타그램·페이스북·블로그·프레젠테이션·A4
- **리사이즈 4-모드** — `fill` 채우기, `fit` 맞추기, `original` 원본, `adapt` 종횡비 재구성. `adapt`는 원본 캔버스 전체(0,0·양축 일치)를 덮는 사각형만 가로 확장하고, 장식용 가로 밴드는 비율을 유지한다. `fit`의 무크롭 보장은 원본이 캔버스 안에 있을 때만 성립하며, 원래 밖의 레이어는 QA가 잡는다.
- **브랜드 키트** — 팔레트·폰트·로고 등록, 이탈 색상 자동 정규화와 로고 ID·소스까지 확인하는 위반 리포트
- **텍스트 측정·줄바꿈** — 등록 글꼴은 sfnt glyph advance로 측정한다. 굵기 미지정 시 등록 face 중 가장 넓은 advance를 쓰고, 등록되지 않은 글꼴은 문자군별 3em fallback을 쓴다. 음수 `letterSpacing`은 유한 수이면 허용하되 측정 폭을 가장 넓은 글리프 폭 아래로 내리지 않아, 과도한 음수 자간이 QA의 false fit을 만들지 않는다. 긴 토큰 분할, 줄 수 제한과 말줄임표를 지원한다.
- **자동 레이아웃·프리미티브·템플릿** — 41단계 결정론 글꼴 후보(기본 최소 60%), 기본 안전영역 내 성장 정책, 정렬·분배·측정 스택·세로 리듬, 12종 원본 채널 템플릿
- **자동 QA** — 캔버스 이탈, 안전영역, 텍스트 불투명도를 배경과 합성한 4.5:1 대비·프레임 적합·완전 가림, 브랜드 준수. 둥근 사각형은 텍스트 프레임 전체가 유효 반지름 안쪽에 있을 때만 배경으로 인정하고, 그 밖과 이미지 배경은 fail-closed. `exportDocument`는 기본적으로 QA 실패를 거부하며 `enforceQa: false`로만 원시 렌더 가능
- **워크스페이스 정책** — `check_design_policy`는 NFKC 정규화 금지어·필수 문구, 승인 상태, 이미지·브랜드 색상·등록 프리셋·페이지 수 제한을 검사해 위반과 출고 허용 여부를 반환한다. regex는 리터럴·안전한 문자 클래스·`^`/`$`·리터럴/클래스 뒤의 `{n}`(0–64)만 허용하며 bare `.`·그룹·교대·escape class·`{n,}`/`{n,m}`는 거부한다. 줄바꿈으로 나뉜 한 텍스트 레이어의 용어는 잡지만, 레이어 간에는 읽기 순서를 신뢰할 수 없어 연결하지 않는다.
- **고전 이미지 처리** — `process_design_image`는 resolver 승인 원본을 순서대로 crop·scale·pad·단색 배경 제거·trim하고 동일한 hardened export writer로 PNG를 쓴다. 축 8,192px·16,000,000px 제한을 적용한다.
- **이미지·글꼴·저장 경계** — 이미지 resolver는 `O_NOFOLLOW` descriptor의 inode·크기(20MiB)를 확인해 제한된 바이트만 읽고, 출력은 디렉터리 inode 재검증·독점 no-follow 생성·regular file/link count 확인을 한다. Node에 `openat`가 없어 최종 검증 뒤 디렉터리 교체 시 외부 빈 파일이 생길 수 있고, 같은 자격 증명 주체는 검사 뒤 hardlink를 추가할 수 있으므로 절대적 containment는 보장하지 않는다. 번들 IBM Plex Sans KR는 `loadSystemFonts: false`로 자동 해석한다.
- **내보내기 제한** — SVG, PNG, JPG, PDF, PPTX, GIF, MP4를 지원한다. 축 8,192px, 페이지당 16,000,000px, 최대 10페이지·1,000레이어이며, GIF와 MP4는 문서 페이지를 프레임으로 묶어 각각 총 32,000,000 프레임 픽셀까지 허용한다. PDF는 FlateDecode 이미지와 UTF-16BE 메타데이터를 사용. PPTX는 고정 timestamp ZIP/PresentationML로 슬라이드별 단색 페이지 배경과 텍스트·사각형·이미지를 개별 편집 객체로 기록한다.
- **결정론** — 동일 입력 바이트 동일성은 회귀 테스트로 검증

`jpg` 형식 요청은 알파를 페이지 배경(또는 `backgroundColor`)에 평탄화한 실제 baseline JPEG를 `.jpg` 확장자로 반환한다. 내장 인코더는 의존성을 추가하지 않으며 기본 quality는 85(1–100 지정 가능), 텍스트의 컬러 가장자리를 보존하기 위해 4:4:4 chroma sampling을 쓴다. `pptx`는 슬라이드 자체의 `<p:bg>`에 페이지 배경을 기록하고 텍스트·사각형·이미지를 PowerPoint·Keynote·Google Slides에서 개별 편집할 수 있는 PresentationML 객체로 내보낸다. 복잡한 path·둥근 사각형 반지름·이미지 `cover`/`contain` crop·필터·그라데이션·애니메이션·전환은 아직 지원하지 않는다. GIF는 결정론적 GIF89a이며 문서 페이지가 프레임이 된다. 공용 팔레트는 최대 256색의 가중 median-cut 양자화와 명시적 동률 순서를 사용하고, 기본 지연은 10 centiseconds(100ms)다. Floyd–Steinberg 디더링은 평면 브랜드 패널을 거칠게 만들 수 있어 라이브러리 `exportDocument`의 `gifDither`에서만 선택적으로 켜며 기본은 꺼져 있다. 단일 페이지는 `NETSCAPE2.0` 루프 확장을 쓰지 않고, 여러 페이지는 무한 반복한다. 현재 MCP `export_design_document` 스키마는 `gifFrameDelay`·`gifDither`·`mp4FrameDuration`을 노출하지 않는다. MP4는 같은 페이지 순서를 Motion JPEG intra frame으로 담고 기본 프레임 길이는 100ms이며, 라이브러리 `exportDocument`에서는 `mp4FrameDuration`에 공통 값 또는 페이지별 값을 줄 수 있다. 고정 timestamp라 바이트 결정론적이고 홀수 치수도 된다. 다만 H.264 동등 품질보다 파일이 훨씬 크며 ffmpeg·QuickTime·VLC는 재생하지만 대부분 브라우저는 Motion JPEG MP4를 네이티브 재생하지 않는다. 짧은 인라인 루프에는 GIF, 비디오 파이프라인 전달에는 MP4를 권장한다. [#15](https://github.com/Doyajin174/teguma/issues/15)는 PPTX·GIF·MP4까지 완료되어 해결되었고, 12종 템플릿의 추가 확장은 선택 사항이며 [#16](https://github.com/Doyajin174/teguma/issues/16)에, 웹 에디터 UI는 [#18](https://github.com/Doyajin174/teguma/issues/18)에 남는다.

조사와 명세: [미리캔버스 파리티 조사](docs/research/013-miricanvas-parity.md), [디자인 엔진 명세](docs/specs/013-design-engine.md)

## 아키텍처

```
AI Agent (Claude Code / Cursor / Codex)
         │ MCP Protocol (stdio)
         ▼
┌─── teguma MCP Server ───┐
│  Brand Context Engine    │
│  Design Token Compressor │
│  Layout Constraints      │
└──────────┬───────────────┘
           │ HTTP RPC API
           ▼
    Penpot (self-hosted)
```

## 개발

```bash
npm install
npm run dev        # 개발 모드 (tsx)
npm run build      # TypeScript 컴파일
npm test           # Vitest
```

## 운영환경

[AGENTS.md](./AGENTS.md) — 이슈 기반 개발, semver 릴리스, 리뷰 파이프라인.

## 리서치

- [Figma 오픈소스 랜드스케이프](docs/research/001-figma-opensource-landscape.md)
- [Claude Design + Figma 페인포인트](docs/research/002-claude-design-figma-painpoints.md)
- [자동 홍보 크리에이티브 조사](docs/research/006-automated-promo-creative-systems.md)
- [프로덕트 명세](docs/specs/001-product-architecture.md)

## 실험

- [회사 홍보 썸네일 테스트베드](experiments/company-promo-testbed/README.md) — SEVASA, 슈퍼쇼츠, 주식회사 로드맵 1080×1080 시안과 재현 가능한 SVG 렌더러
- [회사 홍보 에디토리얼 v2](experiments/company-promo-editorial-v2/README.md) — 자연광·현장 맥락·중립 타이포로 AI 특유의 시각 단서를 줄인 시안과 v1/v2 비교
- [네이버 실노출 썸네일 v3](experiments/company-promo-naver-v3/README.md) — 104×104px 검색 결과와 홈피드 크롭에 맞춘 한 피사체·한 문구 대표 이미지

## 스톡 자산

- [생성형 회사 홍보 배경 원본](stock/generated/company-promo/README.md) — 원본 PNG, 프롬프트, SHA-256, 파생 자산 관계
- [회사 홍보 v2 배경 원본](stock/generated/company-promo-v2/README.md) — 다큐멘터리형 원본 PNG와 AI provenance
- [회사 홍보 v3 배경 원본](stock/generated/company-promo-v3/README.md) — 네이버 대표 이미지용 클로즈업 원본과 AI provenance

## 라이선스

MIT

## 디렉토리

| 경로 | 용도 |
|------|------|
| `docs/research/` | 리서치 결과물 |
| `docs/specs/` | 기획·명세 |
| `docs/releases/` | 버전별 업데이트 리포트 |
| `data/` | 수집 데이터 (JSON/YAML) |
| `scripts/` | 자동화 스크립트 |
| `stock/` | 출처와 생성 이력이 검증되는 재사용 자산 |

## 라이선스

TBD

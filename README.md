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

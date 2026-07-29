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
- [프로덕트 명세](docs/specs/001-product-architecture.md)

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

## 라이선스

TBD

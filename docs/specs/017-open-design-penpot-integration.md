# Open Design + Penpot + teguma 연동 명세

> 상태: Implemented
>
> 작성일: 2026-08-08
>
> 관련 이슈: [#19](https://github.com/Doyajin174/teguma/issues/19)

## 1. 목표

Codex에서 Open Design MCP를 통해 디자인 아티팩트(웹사이트·슬라이드·프로토타입·디자인 시스템)를 생성·편집하고, 생성 결과를 Penpot(셀프호스팅, iMac)에 연동할 수 있는 환경을 조성한다. teguma MCP는 Penpot 인증·데이터 접근을 담당하고, Open Design MCP는 생성 워크플로를 담당한다.

## 2. 아키텍처 (개요)

```
Codex 태스크
  ├── open-design MCP (stdio, 로컬 데몬)
  │     └── Open Design 런타임 (headless, 필요 시 자동 기동)
  │           └── Open Design Cloud 생성 워크플로 (기본 모드)
  └── teguma MCP (PENPOT_URL, PENPOT_SESSION_COOKIE 환경변수)
        └── Penpot 셀프호스팅 (http://192.168.0.183:9001)
```

### 2.1 구성 요소

| 구성 요소 | 역할 | 위치 |
| --- | --- | --- |
| Open Design 앱 | MCP 데몬·런타임 제공 (서명된 앱) | `/Applications/Open Design.app` (0.18.1) |
| `open-design` MCP | Codex 태스크에서 디자인 생성·편집 도구 노출 | Codex MCP 설정 (stdio) |
| teguma MCP | Penpot 연결 (URL + 세션 쿠키) | `~/.codex/config.toml` |
| Penpot | 디자인 데이터·프로젝트 저장소 | `http://192.168.0.183:9001` |

### 2.2 책임 분리

- **Open Design MCP**: 브리프 수집, 실행 모드(기본: Open Design Cloud), 런타임·에이전트 실행, 결과 URL/프리뷰 제공
- **teguma MCP**: Penpot 인증·프로젝트·에셋 데이터 접근
- **Penpot**: 생성 결과의 공유·버전 관리·팀 협업 저장소

> 시크릿 정책: `PENPOT_SESSION_COOKIE` 값은 `~/.codex/config.toml` 환경변수로만 관리하고 문서·커밋·채팅에 노출하지 않는다.

## 3. 사용 방법

### 3.1 Open Design 사용 (Codex 태스크에서)

1. 새 Codex 태스크 시작 (MCP 스냅샷 로드)
2. 디자인 생성 요청 — 예: "Open Design으로 랜딩 페이지를 만들어줘"
3. Open Design 브리프 카드/질문에 답변 → 실행 모드(기본 Open Design Cloud) 확인
4. 생성 완료 후 `studioUrl`/`previewUrl` 결과 링크 확인

### 3.2 Penpot 연동

1. teguma MCP를 통해 Penpot 프로젝트·파일 조회
2. Open Design 생성 결과를 Penpot으로 가져와 팀 협업·버전 관리
3. 연결 상태 확인:

```bash
curl -s -o /dev/null -w '%{http_code}' http://192.168.0.183:9001   # 200 기대
codex mcp get open-design --json                                    # enabled 기대
```

## 4. 완료 조건 (Definition of Done)

- [ ] Open Design 앱 설치 (`/Applications/Open Design.app`, 0.18.1)
- [ ] `codex mcp get open-design --json` → `enabled: true`
- [ ] Penpot HTTP 200 확인 (`http://192.168.0.183:9001`)
- [ ] 설치·등록 절차 문서화 (`docs/research/017-open-design-penpot-setup.md`)
- [ ] 본 명세 문서화 (`docs/specs/017-open-design-penpot-integration.md`)
- [ ] 커밋 본문에 `Closes #19` 포함, 브랜치 푸시 완료

## 5. 향후 확장 (비목표)

- Open Design Cloud 이외의 실행 모드(Local Codex, BYOK)는 사용자가 명시적으로 선택할 때만 활성화
- Penpot ↔ Open Design 자동 동기화(양방향)는 별도 이슈로 분리 검토

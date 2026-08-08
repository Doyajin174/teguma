# Open Design + Penpot 연동 환경 조성 — 설치·등록 작업 기록

- 작성일: 2026-08-08
- 관련 이슈: [#19](https://github.com/Doyajin174/teguma/issues/19)
- 상태: 적용 완료 (실기기 설치·등록 검증 기준)

## 1. 결론

Open Design 앱 설치, Codex MCP 등록, Penpot 연결 확인까지 모두 완료했다. 이후 Codex 태스크에서 `open-design` MCP 서버를 바로 사용할 수 있고, teguma MCP의 Penpot 연결 환경도 그대로 유지된다.

## 2. 사전 확인 사항

- Open Design 스킬(플러그인)은 설치돼 있음: `~/.codex/plugins/cache/openai-curated-remote/open-design/0.5.2/skills/open-design-mode/`
- Open Design 데스크톱 앱은 미설치 상태였음
- Penpot은 iMac(`http://192.168.0.183:9001`)에서 실행 중이었음 (HTTP 200)
- teguma MCP 설정에 `PENPOT_URL=http://192.168.0.183:9001` 및 세션 쿠키가 반영돼 있음 (`~/.codex/config.toml`)

> 주의: 세션 쿠키(`PENPOT_SESSION_COOKIE`) 값은 시크릿이므로 문서·커밋에 포함하지 않는다. 설정 파일에서 환경변수로만 관리한다.

## 3. 설치 절차

### 3.1 Open Design 앱 설치 (Homebrew 공식 cask)

```bash
brew install --cask open-design
```

- 설치 결과: cask `open-design` 0.18.1 설치 성공
- 앱 경로: `/Applications/Open Design.app`
- 서명 확인: `codesign -dv /Applications/Open Design.app` → identifier `io.open-design.desktop`, arm64, hardened runtime
- Homebrew 업데이트(6.0.13 → 6.0.15)와 함께 진행됨. supabase/tap 미신뢰 경고는 이 설치와 무관

### 3.2 Codex MCP 등록

Open Design 설치본의 서명된 실행파일을 사용한다. macOS 기본 유틸 `/usr/bin/od`와 혼동하면 안 된다.

```bash
"/Applications/Open Design.app/Contents/MacOS/Open Design" --headless --mcp-install codex
```

- 출력: `Open Design MCP installed for Codex` + headless 런타임 기동(`http://127.0.0.1:60986`)
- 등록 확인 후 `Ctrl+C`로 포그라운드 데몬 종료 (MCP는 이후 태스크에서 필요 시 자동 기동됨)

### 3.3 Penpot 연결 확인

```bash
curl -s -o /dev/null -w '%{http_code}' http://192.168.0.183:9001
```

- 결과: `200`

## 4. 검증 결과

### 4.1 MCP 등록 확인

```bash
codex mcp get open-design --json
```

요약:

- 이름: `open-design`
- 상태: `enabled`
- 전송 방식: stdio
- 명령: `/Applications/Open Design.app/Contents/Frameworks/Open Design Helper.app/Contents/MacOS/Open Design Helper`
- 인자: `.../Resources/app/prebundled/daemon/daemon-cli.mjs mcp`
- 환경: `OD_MCP_BOOTSTRAP_ARGS`(`-g -j <앱경로> --args --headless`), `OD_DATA_DIR`(release-stable 네임스페이스), `OD_SIDECAR_IPC_PATH`(데몬 소켓)

### 4.2 Penpot 연결 확인

- `GET http://192.168.0.183:9001` → `200`
- teguma MCP(`PENPOT_URL`, 세션 쿠키) 설정은 기존 값 유지

## 5. 트러블슈팅

- `od mcp install codex` 실행 시 실패 또는 엉뚱한 동작 → macOS 기본 유틸 `/usr/bin/od`와 혼동했을 가능성. 반드시 Open Design 설치본의 실행파일(`/Applications/Open Design.app/Contents/MacOS/Open Design`)을 전체 경로로 사용
- `codex mcp get open-design --json` → `No MCP server named 'open-design' found` → MCP 미등록 상태. `--headless --mcp-install codex` 재실행 후 재확인
- 설치 중 네트워크 오류·권한 프롬프트 → brew 다운로드 실패 또는 Gatekeeper 문제. sudo 자동 실행 금지, 오류 메시지 확인 후 보고
- MCP 등록은 됐지만 현재 태스크에서 도구 미노출 → 현재 세션의 MCP 스냅샷이 이전 버전. 새 Codex 태스크를 시작해 새 스냅샷 로드
- headless 기동 시 포트 점유 → 이전 데몬 잔존 가능성. 기존 프로세스 종료 후 재시도

## 6. 참고

- Open Design 다운로드/문서: https://open-design.ai/download/
- open-design-mode 스킬: `~/.codex/plugins/cache/openai-curated-remote/open-design/0.5.2/skills/open-design-mode/SKILL.md`
- 연동 아키텍처·사용 방법: [docs/specs/017-open-design-penpot-integration.md](../specs/017-open-design-penpot-integration.md)

# lint 게이트 구축 + iMac SSH 푸시 게이트 명세

> 상태: Draft (이슈 #9)
>
> 작성일: 2026-08-09
>
> 관련 이슈: [#9](https://github.com/Doyajin174/teguma/issues/9)

## 1. 배경

- `package.json`에 `"lint": "eslint src/"`가 선언돼 있지만 ESLint 패키지·설정이 없어
  `npm run lint`가 `eslint: command not found`로 죽는다.
- GitHub Actions(ci.yml)는 `tsc`·`test`·`build`만 실행하고 lint는 호출하지 않는다.
- 사용자 결정(2026-08-09): GitHub Actions를 사용하지 않고 iMac SSH 푸시 게이트로
  교체한다. 부채를 남기지 않도록 검사 환경은 CI와 동일 조건(전체 테스트 포함)을 맞춘다.

## 2. 도구 선택 (ESLint 10 + typescript-eslint)

### 2.1 대안 비교 (2026-08-09 리서치)

| 기준 | ESLint 10 + typescript-eslint | Biome |
| --- | --- | --- |
| 현재 버전 | ESLint 10.8.1 (9는 EOL), typescript-eslint 8.66 (ESLint 10 지원) | 2.x |
| TS 인식 | typescript-eslint typed linting 성숙 | type-aware 분석 존재하나 신규 |
| 플러그인 생태계 | 최대 (React·테스트·보안 등) | 성장 중, 제한적 |
| 설정 유지비 | flat config 1개 + 통합 패키지 — 중간 | biome.json 1개 — 낮음 |
| 포매터 | 별도 필요 | 내장 |
| 장기 리스크 | 대규모 표준, 마이그레이션 리스크 낮음 | 젊은 생태계, 규칙 등가성 검증 필요 |

### 2.2 선택 근거

**ESLint 10 + typescript-eslint 채택.** teguma는 TS strict + vitest 기반 소형 프로젝트로
lint 범위가 `src/` 한 곳이라 설정 유지비 차이는 작다. typescript-eslint의 typed linting·
플러그인 호환성·장기 생태계 안정성이 "부채 안 쌓기" 기준에 부합한다. Biome은 속도·단순성에서
유리하지만 규칙 등가성 검증과 포매터 이중화가 추가 작업이 된다.

## 3. lint 구성

- 파일: `eslint.config.mjs` (flat config, ESLint 10 표준)
- 베이스: `js.configs.recommended` + `tseslint.configs.recommended`
- 범위: `src/` (package.json의 `lint` 스크립트 유지)
- 무시: `dist/`, `node_modules/`, `experiments/`, `web/`, `stock/`, `data/`

### 3.1 예외 정책 (의도적)

- 기존 코드의 스타일 지적은 이번에 전부 고치지 않고 문서화된 예외로 둔다 — 예외 목록에
  항목별 사유 기록.
- 새 코드는 예외 없이 규칙을 지킨다 (게이트가 강제).
- 예외 추가는 이 명세 갱신 + 리뷰를 통해서만 (조용한 disable 금지).

### 3.2 예외 목록 (2026-08-09 기준)

| 위치 | 규칙 | 사유 |
| --- | --- | --- |
| `eslint.config.mjs` (전역) | `@typescript-eslint/no-explicit-any: off` | 기존 코드의 `any` 사용 다수 — 점진 정리 대상 (전면 재작성 회피) |
| `src/design/export.ts` `pdfEscape` | `no-control-regex` (eslint-disable-next-line) | PDF 토큰화 보호를 위한 의도된 제어문자 이스케이프 |
| `converter.ts` S 명령 | — (write-only 변수 제거) | S 반사 제어점은 원래 미적용 상태 — 기존 동작 유지, 후속 개선 후보 (lint 정리로 변수만 제거) |

| 위치 | 규칙 | 사유 |
| --- | --- | --- |
| `src/design/export.ts` `pdfEscape` | `no-control-regex` (eslint-disable-next-line) | PDF 토큰화 보호를 위한 의도된 제어문자 이스케이프 |
| `converter.ts` S 명령 | — (write-only 변수 제거) | S 반사 제어점은 원래 미적용 상태 — 기존 동작 유지, 후속 개선 후보 (lint 정리로 변수만 제거) |

## 4. iMac SSH 푸시 게이트 (GitHub Actions 대체)

### 4.1 구조

```text
[개발 맥] git push github  (pre-push 훅이 iMac 게이트 통과 후에만 허용)
    │
    ├─ pre-push 훅 ── git push imac <branch>
    │                     ▼
    │              [iMac] ~/ci/teguma.git (bare)
    │                     ▼ pre-receive 훅 (게이트 — 실패 시 푸시 거부)
    │              ~/ci/teguma-work (푸시된 트리로 동기화)
    │              npm ci → lint → tsc → test → build
    │              실패 시 exit 1 → iMac push 거부 → GitHub push 차단
    │              (통과 후 post-receive가 work를 정식 동기화)
```

### 4.2 구성 요소 (저장소 커밋 대상)

| 파일 | 역할 |
| --- | --- |
| `scripts/gate/run.sh` | 로컬·iMac 공용 게이트 (lint+tsc+test+build) |
| `scripts/hooks/pre-push` | iMac 게이트 통과 후 GitHub 푸시 허용 |
| `scripts/gate/imac-pre-receive` | iMac bare repo 게이트 훅 (실패 시 푸시 거부 — post-receive는 거부 불가) |
| `scripts/gate/imac-post-receive` | iMac bare repo work 동기화 훅 (게이트 통과 후) |

### 4.3 iMac 환경 (1회 설정)

- node: `/opt/homebrew/bin/node` (v26) — SSH 비대화형 셸 PATH에 `/opt/homebrew/bin` 추가
- 테스트 의존: ffmpeg·libreoffice·poppler(pdftoppm)·Python pillow (CI와 동일 조건)
- bare repo: `~/ci/teguma.git`, work 체크아웃: `~/ci/teguma-work`
  (work의 `origin`은 bare repo — pre-receive의 임시 ref fetch와 post-receive 동기화에 사용)

### 4.4 게이트 우회 방지

- 웹 UI 머지는 훅을 타지 않으므로 머지 명령도 게이트로 감싼다 —
  `scripts/gate/merge-gated.sh` (게이트 통과 확인 후 `gh pr merge --squash`).
- 운영 문서(AGENTS.md)에 "웹 UI 머지 금지 — gated 머지 스크립트 사용" 규정.

## 5. 완료 조건 (이슈 #9 DoD)

- [ ] 도구 선택 근거 (본 문서 2장)
- [ ] devDependency·설정 추가 (ESLint 10 + typescript-eslint)
- [ ] `npm run lint` clean checkout 통과
- [ ] iMac SSH 게이트 구축 (pre-push → post-receive → lint·tsc·test·build, 실패 시 push 차단)
- [ ] 예외 정책 문서화 (3.1 + 예외 목록)
- [ ] 기존 테스트·빌드 통과 (iMac 게이트 기준)

## 6. 리스크

| 리스크 | 대응 |
| --- | --- |
| 기존 코드 lint 에러 다수 | 예외 목록 문서화 + 점진 적용 (3.1) |
| iMac 의존 설치 실패 | CI와 동일 조건 명시, 로그 확인 후 재시도 |
| 훅 우회(웹 UI 머지) | 운영 문서 규정 + gated 머지 스크립트 (4.4) |
| npm ci 매 푸시 시간 | lockfile 변경 시에만 재설치 (스크립트에서 판단) |

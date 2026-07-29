# teguma 운영환경

Figma 오픈소스 프로젝트 컬렉션. 이슈 기반 개발, 릴리스 관리, 자동화 리뷰를 따른다.

---

## 핵심 원칙

- **1 이슈 = 1 브랜치 = 1 워크트리** — 워크트리는 항상 깔끔하게 유지
- **작업 순서**: 이슈 조사(인터넷 조사 포함) → 기획/명세 작성 → 구현 → PR → 리뷰 → 머지
- **tidy**: 레포 구조·거버넌스·문서 정비 시 `tidy` 스킬 사용
- **atlas**: 코드 아틀라스 유지보수 시 `maintain-code-atlas` 스킬 사용

---

## 브랜치·워크트리 규약

```
main            ← 항상 릴리스 가능 상태
feat/<issue>-<slug>
fix/<issue>-<slug>
hotfix/<slug>
research/<slug> ← 조사 전용 (머지 안 할 수 있음)
```

- 워크트리 경로: `../teguma-wt/<branch-name>`
- 머지 후 워크트리 즉시 제거 (`git worktree remove`)
- main은 fast-forward 전용, force-push 금지

---

## 커밋 규약 (Conventional Commits)

```
feat: <summary>        → minor
fix: <summary>         → patch
docs: <summary>
chore: <summary>
refactor: <summary>
test: <summary>
perf: <summary>
breaking: <summary>    → major
```

- 본문에 `Closes #<issue>` 또는 `Refs #<issue>` 포함
- 1 커밋 = 1 논리 변경. WIP 커밋은 squash 전까지만 허용

---

## 1. 리뷰 절차

1. **셀프 리뷰** — `git diff main...HEAD` 전체 읽기, 오타·디버그 코드·주석 처리 확인
2. **AI 리뷰** — 설계 원칙(SOLID, DRY, KISS)·엣지 케이스·명세 일치 여부 점검
3. **fixup** — 지적 사항 반영, `git commit --fixup` 사용
4. **squash merge** — `gh pr merge --squash --delete-branch`

리뷰 체크리스트:
- [ ] 명세(spec)와 구현이 일치하는가
- [ ] 에러 핸들링·빈 입력·대형 입력 엣지 케이스
- [ ] 시크릿·개인정보 하드코딩 없음
- [ ] 테스트가 핵심 경로를 커버하는가
- [ ] 불필요한 의존성 추가 없음

---

## 2. 머지 후 루틴

```bash
git checkout main && git pull --ff-only
git worktree remove ../teguma-wt/<branch>
git branch -d <branch>
gh issue close <issue>   # 또는 PR 머지가 자동 close
```

- 이슈 닫힘 확인 후 **릴리스 판단** (아래 3번 참조)
- 마일스톤 진행률 갱신

---

## 3. 릴리스 체계

- **semver** 엄격 준수: `MAJOR.MINOR.PATCH`
- feat → minor, fix → patch, breaking → major
- CHANGELOG.md 자동 갱신 (Conventional Commits 기반)
- 릴리스 시 작성:
  - `CHANGELOG.md` 항목
  - GitHub Release 노트 (What Changed / Breaking / Migration)
  - 태그: `v<semver>`
- 매 버전 **업데이트 리포트** 작성 → `docs/releases/v<version>.md`

---

## 4. 핫픽스 절차

긴급 수정용 빠른 경로:

1. `hotfix/<slug>` 브랜치를 main에서 생성
2. 명세 생략 가능, AI 리뷰 생략 가능
3. 최소 셀프 리뷰(변경 diff 읽기)는 필수
4. 머지 후 즉시 patch 릴리스
5. 사후에 이슈 등록 + 회고 기록

---

## 5. 주간 회고

매주 금요일(또는 마지막 작업일) `docs/retro/YYYY-WNN.md` 작성:

- **완료**: 이번 주 머지된 PR 목록
- **밀린 것**: 이월 이슈 + 사유
- **배운 것**: 기술·프로세스 인사이트
- **다음 주 우선순위**: 최대 3개

---

## 6. 의존성·보안 관리 (추가)

- 새 의존성 추가 시 이슈에 **도입 근거** 기록 (대안 비교 포함)
- 월 1회 `npm audit` / `pip audit` / `cargo audit` 실행 → 이슈 등록
- Dependabot / Renovate PR은 chore로 분류, 주간 회고 때 일괄 처리
- 시크릿은 환경변수 또는 `.env`(gitignore)로만 관리

---

## 7. 테스트 정책 (추가)

- 핵심 로직(파서, 스크래퍼, 데이터 변환)은 단위 테스트 필수
- PR에 테스트 없는 feat/fix는 리뷰에서 반려
- 테스트 프레임워크: 프로젝트 언어에 맞춰 선택, `test/` 또는 `__tests__/` 디렉토리
- CI에서 테스트 실패 시 머지 불가

---

## 8. 문서 유지보수 (추가)

- README.md: 프로젝트 소개, 설치, 사용법, 기여 가이드
- API/CLI 변경 시 문서 동시 업데이트 (코드와 문서가 같은 PR에)
- `docs/` 디렉토리에 명세·리서치·릴리스 노트 보관
- 문서 전용 변경은 `docs:` 커밋

---

## 9. CI/CD 파이프라인 (추가)

- GitHub Actions 기본 워크플로:
  - PR: lint → test → build
  - main push: test → changelog 검증 → 릴리스 가능 여부 체크
  - tag push: 릴리스 노트 생성 → 아티팩트 배포
- CI 배지 README에 표시

---

## 10. 기술 부채·리팩토링 관리 (추가)

- `tech-debt` 라벨 이슈로 추적
- 매 스프린트(또는 격주) 기술 부채 이슈 1개 이상 처리
- 대규모 리팩토링은 별도 이슈 + 명세 작성 후 진행

---

## 11. 인시던트·포스트모템 (추가)

- 운영 장애·데이터 손실 발생 시:
  1. 핫픽스 절차로 즉시 대응
  2. `docs/incidents/YYYY-MM-DD-<slug>.md` 포스트모템 작성
  3. 재발 방지 액션 아이템 → 이슈 등록

---

## 12. 이슈 관리 규약 (추가)

- 이슈 템플릿: Bug / Feature / Research / Tech Debt
- 라벨: `bug`, `feat`, `research`, `tech-debt`, `hotfix`, `docs`, `breaking`
- 마일스톤: 릴리스 버전과 1:1 대응
- 이슈 본문 최소 요건: 배경, 목표, 완료 조건(Definition of Done)

---

## 디렉토리 구조 (초기)

```
teguma/
├── AGENTS.md          ← 이 파일 (운영환경)
├── README.md
├── CHANGELOG.md
├── docs/
│   ├── specs/         ← 기획·명세
│   ├── research/      ← 리서치 결과
│   ├── releases/      ← 버전별 업데이트 리포트
│   ├── retro/         ← 주간 회고
│   └── incidents/     ← 포스트모템
├── data/              ← 수집 데이터 (JSON/YAML)
├── scripts/           ← 자동화 스크립트
└── test/
```

---

## 도구·스킬 매핑

| 상황 | 사용 |
|------|------|
| 레포 구조·문서 정비 | `tidy` 스킬 |
| 코드 아틀라스 갱신 | `maintain-code-atlas` 스킬 |
| 인터넷 조사 | web_search |
| 이슈·PR 관리 | GitHub (gh CLI) |
| 릴리스 노트 | Conventional Commits + 수동 보강 |

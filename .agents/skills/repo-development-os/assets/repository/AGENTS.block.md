# Repository Development Routine

- Before substantive work, run `python3 .agents/skills/repo-development-os/scripts/repo_os.py
  preflight --repo .`. Exit 1 means clear the reported debt before new work; exit 2 means report the
  unverified state and stop.
- Do not implement without one issue containing a goal, completion scenario, and measurable
  acceptance criteria. Check current code and pull requests, research authoritative internet
  sources, and record a compact specification first.
- Use one issue, one `codex/issue-N-slug` branch, and one clean linked worktree under the stable
  sibling worktree root. Update from `main` before measurement.
- Prioritize the user's observable completion scenario and smooth real use. Keep planning and
  implementation to the smallest sufficient scope, but never skip, combine, or reorder a mandatory
  routine step.
- Load and follow `tidy` without waiting for the user to name it when the task's actual goal is
  repository-wide structure, governance, documentation conventions, duplication, or cleanup. Do
  not attach a broad tidy pass to ordinary feature or fix work or expand the issue scope.
- When `docs/code-atlas` exists and work locates or changes a mapped concept, load and follow
  `maintain-code-atlas` without waiting for the user to name it. Revalidate current sources and
  update only directly affected cards during authorized implementation; never bulk-create or
  refresh unrelated cards.
- Implement the smallest change that satisfies the issue. A pull request closes at most 3 issues,
  changes at most 50 files, uses `#N` in every change commit, and contains `Closes #N`.
- Normal review order is exact: complete diff self-review, one independent read-only AI review, one
  fixup round when findings exist, rerun relevant checks, then squash merge.
- After merge, update `main`, remove the issue worktree and branch, confirm issue closure, and decide
  the release before starting new work.
- Releases use exact SemVer: breaking is major, `feat` is minor, and `fix` is patch. Update CHANGELOG
  and one version report, then create the matching tag and GitHub Release from merged `main`.
- A hotfix may omit only the compact specification and independent AI review. Record every omission;
  still require an issue, regression check, rollback note, pull request, cleanup, and patch decision.
- Record recurring build traps in the runbook and completed, delayed, learned, and next-priority
  notes in the weekly retrospective.
- Do not add an organization harness, daemon, hook, database, dashboard, scheduled scan, automatic
  fixer, or all-in-one command for this routine.

## Code Review Rules

- Block data loss, security defects, acceptance-criteria failures, and failing required checks.
- Verify the required sequence and issue traceability; leave formatting and other mechanical checks
  to CI.

Read `.agents/skills/repo-development-os/SKILL.md` for command details.

---
name: repo-development-os
description: >-
  Install and follow a small repository-local issue-to-release routine with a mandatory read-only
  preflight, exact review order, SemVer release records, and no organization harness.
---

# Repository Development OS

Use existing Git, GitHub, Codex, and repository files. The routine is strict; its implementation is
small. Do not add a daemon, hook, database, dashboard, scheduled scan, automatic fixer, global Codex
state, or an all-in-one command.

## Install

```bash
python3 <source-skill>/scripts/repo_os.py install --repo <path-inside-target-repo>
```

Installation adds the local skill, the managed `AGENTS.md` and pull-request blocks, and missing
starter files. It preserves project-specific text and can be rerun. Use `--dry-run` to preview.

## Start every substantive task

```bash
python3 .agents/skills/repo-development-os/scripts/repo_os.py preflight --repo .
```

- Exit `0`: required local and GitHub state was verified and no cleanup finding exists.
- Exit `1`: report the findings, clear them before new work, and rerun preflight.
- Exit `2`: required state could not be verified; report the gap and stop.

Preflight only reads the selected repository. It never mutates Git, GitHub, issues, pull requests,
tags, releases, or worktrees.

## Practical routing

- Prioritize the user's observable completion scenario and smooth real use. Keep planning and
  implementation to the smallest sufficient scope, but never skip, combine, or reorder a mandatory
  routine step.
- Load and follow `tidy` without waiting for the user to name it when the task's actual goal is
  repository-wide structure, governance, documentation conventions, duplication, or cleanup. Do
  not attach a broad tidy pass to ordinary feature or fix work, and do not expand the issue scope.
- When `docs/code-atlas` exists and work locates or changes a mapped concept, load and follow
  `maintain-code-atlas` without waiting for the user to name it. Revalidate current sources first
  and update only directly affected cards during authorized implementation. Never bulk-create or
  refresh unrelated cards.

## Normal sequence

1. Use one issue containing a Goal, Completion scenario, and measurable Acceptance criteria.
2. Check current code and pull requests, research authoritative internet sources, and write a
   compact specification.
3. Use one `codex/issue-N-slug` branch and one clean linked worktree under the stable sibling root.
   Update from `main` before measurement.
4. Implement the smallest change that satisfies the issue.
5. Open one human-readable pull request. It closes at most 3 issues, changes at most 50 files, uses
   `#N` in every change commit, and contains `Closes #N`.
6. Read the full diff once for self-review.
7. Run one independent read-only AI review.
8. Apply one fixup round when findings exist and rerun relevant checks.
9. Squash merge.
10. Update `main`, remove the issue worktree and branch, confirm issue closure, and decide release.

Do not reorder, combine, or omit these steps for normal work.

## Release

```bash
python3 .agents/skills/repo-development-os/scripts/repo_os.py release-plan --repo .
python3 .agents/skills/repo-development-os/scripts/repo_os.py prepare-release \
  --repo . \
  --validation "relevant checks passed" \
  --rollback "revert the release commit" \
  --write
```

Breaking changes are major, `feat` is minor, and `fix` is patch. `prepare-release` refuses a
different version and requires validation and rollback evidence. Review its CHANGELOG and version
report changes, merge them to `main`, then create the exact matching tag and GitHub Release.

## Hotfix

A hotfix may omit only the compact specification and independent AI review. Record each omission in
the pull request. Still require an issue, regression check, rollback note, pull request, squash
merge, post-merge cleanup, and patch-release decision.

## Runbook and retrospective

Record a build, test, packaging, deployment, or release trap when it could recur. Do not record
secrets or full environment dumps. Each week record completed work, delayed work, learned lessons,
and the next priority in the existing retrospective surface.

## Helper commands

- `install --repo PATH [--dry-run]`
- `preflight --repo PATH [--format human|json]`
- `status --repo PATH [--format human|json]`
- `release-plan --repo PATH [--ref REF]`
- `prepare-release --repo PATH [--version vX.Y.Z] [--date YYYY-MM-DD]
  --validation TEXT --rollback TEXT [--write]`

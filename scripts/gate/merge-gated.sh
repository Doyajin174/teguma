#!/usr/bin/env bash
# gated squash 머지 (명세 020 4.4 — 웹 UI 머지는 훅을 우회하므로 금지).
#
# 사용: scripts/gate/merge-gated.sh <PR번호>
set -euo pipefail
PR="${1:?PR 번호 필요}"
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "== [merge-gated] 게이트 확인 =="
# 실제 PR head 트리를 게이트한다 (리뷰 M2 — 현재 체크아웃 검증).
PR_SHA="$(gh pr view "$PR" --json headRefOid -q .headRefOid)"
CURRENT_SHA="$(git rev-parse HEAD)"
if [[ "$CURRENT_SHA" != "$PR_SHA" ]]; then
  echo "오류: 현재 HEAD(${CURRENT_SHA:0:12})가 PR #$PR head(${PR_SHA:0:12})가 아닙니다" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "오류: 워크트리가 깨끗하지 않습니다 — 커밋/정리 후 재시도" >&2
  exit 1
fi
scripts/gate/run.sh --skip-install
echo "== [merge-gated] PR #$PR 머지 =="
gh pr merge "$PR" --squash --delete-branch

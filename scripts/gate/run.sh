#!/usr/bin/env bash
# teguma 게이트 (명세 020 4.2) — lint + tsc + test + build.
# 로컬·iMac SSH 게이트(post-receive) 공용.
#
# 사용: scripts/gate/run.sh [--skip-install]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

if [[ "${1:-}" != "--skip-install" ]]; then
  # 트리가 lockfile과 일치하지 않을 때만 npm ci (리뷰 M1 — npm ls로 판단).
  if ! npm ls --depth=0 >/dev/null 2>&1; then
    echo "== [gate] npm ci =="
    npm ci
  fi
fi

echo "== [gate] lint =="
npm run lint
echo "== [gate] tsc =="
npx tsc --noEmit
echo "== [gate] test =="
npm test
echo "== [gate] testbed golden diff =="
npm run testbed:promo:v2:check
npm run testbed:promo:v3:check
echo "== [gate] build =="
npm run build
echo "== [gate] OK =="

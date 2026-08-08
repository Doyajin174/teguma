#!/usr/bin/env bash
#
# Open Design → Penpot 핸드오프 live smoke (명세 019 13장).
#
# opt-in 스크립트 — CI 미포함. 네트워크·시크릿 필요.
# 실행 전제:
#   1. open-design MCP 도구가 노출된 새 Codex 태스크
#      (codex mcp get open-design --json → enabled)
#   2. Penpot HTTP 200 (PENPOT_URL, 예: http://192.168.0.183:9001)
#   3. PENPOT_URL / PENPOT_SESSION_COOKIE(또는 PENPOT_TOKEN) 설정
#   4. npm run build 완료 (dist/index.js 사용)
#
# 사용:
#   PENPOT_URL=... PENPOT_SESSION_COOKIE=... PENPOT_FILE_ID=<id> \
#     ./scripts/smoke-open-design-handoff.sh --bundle ./my-bundle
#
# 시크릿 경계 (6.1): 쿠키·토큰은 환경변수로만 주입 — 로그·번들·커밋에 노출 금지.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

BUNDLE_DIR=""
FORCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle) BUNDLE_DIR="$2"; shift 2 ;;
    --force) FORCE="--force"; shift ;;
    --help|-h)
      sed -n '1,40p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "알 수 없는 인자: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$BUNDLE_DIR" ]]; then
  echo "오류: --bundle <dir> 필요" >&2
  exit 1
fi

echo "== [1/7] 전제 확인 =="
if ! command -v codex >/dev/null 2>&1; then
  echo "  codex CLI 없음 — open-design MCP 확인 생략" >&2
else
  codex mcp get open-design --json 2>/dev/null | grep -q '"enabled": true' \
    && echo "  open-design MCP: enabled" \
    || echo "  경고: open-design MCP enabled 확인 실패 — 새 태스크에서 스냅샷 로드 필요" >&2
fi
if [[ -z "${PENPOT_URL:-}" ]]; then
  echo "오류: PENPOT_URL 미설정" >&2
  exit 1
fi
if [[ -z "${PENPOT_SESSION_COOKIE:-}" && -z "${PENPOT_TOKEN:-}" ]]; then
  echo "오류: PENPOT_SESSION_COOKIE 또는 PENPOT_TOKEN 필요 (시크릿은 환경변수로만)" >&2
  exit 1
fi
if [[ -z "${PENPOT_FILE_ID:-}" ]]; then
  echo "오류: PENPOT_FILE_ID 필요 (Penpot UI에서 대상 파일 ID 확인)" >&2
  exit 1
fi
status="$(curl -s -o /dev/null -w '%{http_code}' "$PENPOT_URL" || true)"
if [[ "$status" != "200" ]]; then
  echo "오류: Penpot HTTP $status (200 기대)" >&2
  exit 1
fi
echo "  Penpot: HTTP $status"
[[ -f dist/index.js ]] || { echo "오류: npm run build 먼저 실행" >&2; exit 1; }

echo "== [2/7] 번들 검증·변환 미리보기 (dry-run) =="
node dist/index.js import-open-design --bundle "$BUNDLE_DIR" --dry-run > /tmp/od-handoff-preview.json
node - <<'EOF'
const r = require("/tmp/od-handoff-preview.json");
console.log(`  action: ${r.action} | page: ${r.pageName} | tokens: ${r.canonical?.tokenCount ?? "-"}`);
console.log(`  summary: layers ${r.summary.layers.imported}/${r.summary.layers.source} · text ${r.summary.text.imported}/${r.summary.text.source} · colors ${r.summary.colors.imported}/${r.summary.colors.source}`);
console.log(`  loss items: ${r.lossReport.items.length} (unsupported ${r.lossReport.items.filter(i => i.severity === "unsupported").length})`);
EOF

echo "== [3/7] 반입 (write) =="
node dist/index.js import-open-design --bundle "$BUNDLE_DIR" --penpot-file-id "$PENPOT_FILE_ID" $FORCE > /tmp/od-handoff-import.json
node - <<'EOF'
const r = require("/tmp/od-handoff-import.json");
console.log(`  action: ${r.action} | pageId: ${r.pageId} | pageName: ${r.pageName}`);
EOF

echo "== [4/7] 재조회 (get-page-layout / get-tokens — teguma MCP로 수동 확인) =="
echo "  MCP 호출: get_page_layout({ fileId: \"$PENPOT_FILE_ID\", pageId: <위 pageId> })"
echo "  MCP 호출: get_tokens({ fileId: \"$PENPOT_FILE_ID\" })"
echo "  canonical 문서: data/imports/open-design/od-*/tokens.canonical.json (재조회 검증용 산출물)"

echo "== [5/7] idempotency 재현 (같은 번들 재실행 → unchanged 기대) =="
node dist/index.js import-open-design --bundle "$BUNDLE_DIR" --penpot-file-id "$PENPOT_FILE_ID" $FORCE > /tmp/od-handoff-rerun.json
node - <<'EOF'
const r = require("/tmp/od-handoff-rerun.json");
console.log(`  rerun action: ${r.action} (unchanged 기대)`);
if (r.action !== "unchanged") { console.error("  실패: idempotency 위반"); process.exit(1); }
EOF

echo "== [6/7] 번들 수정 후 재실행 → replaced 기대 (선택) =="
if [[ -n "${OD_HANDOFF_MODIFY:-}" ]]; then
  # OD_HANDOFF_MODIFY가 지시하는 파일을 수정한 번들로 재실행
  node dist/index.js import-open-design --bundle "$OD_HANDOFF_MODIFY" --penpot-file-id "$PENPOT_FILE_ID" $FORCE | tee /tmp/od-handoff-replaced.json
else
  echo "  생략 (OD_HANDOFF_MODIFY=<수정된 번들 디렉터리> 지정 시 replaced 검증)"
fi

echo "== [7/7] 정리·보고 =="
echo "  스모크 요약:"
echo "    - 산출물: $BUNDLE_DIR (시크릿 없음 확인 필수)"
echo "    - import 기록: data/imports/open-design/"
echo "    - 결과 요약을 이슈 #32 코멘트·PR에 기록 (릴리스 리포트 아님)"
echo "  완료."

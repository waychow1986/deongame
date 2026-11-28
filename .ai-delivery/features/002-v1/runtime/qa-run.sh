#!/usr/bin/env bash
# Independent test entry for DeonGame 002-v1. Writes QA_RESULT_PATH (contract v2).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${QA_WORK_DIR:-$(pwd)}"
: "${QA_RESULT_PATH:=$WORK/qa-result.json}"
: "${QA_EVIDENCE_DIR:=$WORK/evidence}"
export QA_RESULT_PATH QA_EVIDENCE_DIR
mkdir -p "$QA_EVIDENCE_DIR"

if [ ! -d "$WORK/node_modules/playwright" ]; then
  (cd "$WORK" && { [ -f package.json ] || echo '{"name":"qa-work","private":true,"type":"module"}' > package.json; } \
    && npm install --no-audit --no-fund --silent playwright@1.65.1 >"$QA_EVIDENCE_DIR/npm-install.log" 2>&1) || true
fi
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d /ms-playwright ]; then export PLAYWRIGHT_BROWSERS_PATH=/ms-playwright; fi
if ! ls "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" 2>/dev/null | grep -q chromium; then
  (cd "$WORK" && npx playwright install chromium >>"$QA_EVIDENCE_DIR/npm-install.log" 2>&1) || true
fi

export QA_NODE_MODULES="$WORK/node_modules"
node "$HERE/qa/run.mjs"
code=$?
if [ ! -s "$QA_RESULT_PATH" ]; then
  echo "runner exited $code without result" >&2
  exit 1
fi
exit 0

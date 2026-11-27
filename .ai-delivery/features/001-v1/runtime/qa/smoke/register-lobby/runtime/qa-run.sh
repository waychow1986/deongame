#!/usr/bin/env bash
# Smoke case: register through the UI, land in the lobby, log in again from a fresh browser.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(pwd)"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
: "${QA_RESULT_PATH:=$WORK/result.json}"
: "${QA_EVIDENCE_DIR:=$WORK/evidence}"
export QA_RESULT_PATH QA_EVIDENCE_DIR
mkdir -p "$QA_EVIDENCE_DIR"

if [ ! -d "$WORK/node_modules/playwright-core" ] || [ ! -d "$WORK/node_modules/socket.io-client" ] || [ ! -d "$WORK/node_modules/pg" ]; then
  [ -f "$WORK/package.json" ] || echo '{"name":"qa-work","private":true}' > "$WORK/package.json"
  npm install --silent --no-audit --no-fund playwright-core@1.65.1 socket.io-client@4 pg@8 >"$QA_EVIDENCE_DIR/npm-install.log" 2>&1 || true
fi

node "$HERE/qa/main.mjs" 2>&1 | tee "$QA_EVIDENCE_DIR/run.log"
exit 0

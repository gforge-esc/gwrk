#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-notify.test.ts || { echo "FAIL: T021 — missing src/server/slack-notify.test.ts" >&2; exit 1; }
test -f src/server/slack-actions.test.ts || { echo "FAIL: T021 — missing src/server/slack-actions.test.ts" >&2; exit 1; }
echo "PASS: T021 — Implement test strategy for Phase 3"
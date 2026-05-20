#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-notify.ts || { echo "FAIL: T017 — file not found: src/server/slack-notify.ts" >&2; exit 1; }
grep -q 'slack' src/server/slack-notify.ts || { echo "FAIL: T017 — src/server/slack-notify.ts missing 'slack'" >&2; exit 1; }
echo "PASS: T017 — Implement src/server/slack-notify.ts"

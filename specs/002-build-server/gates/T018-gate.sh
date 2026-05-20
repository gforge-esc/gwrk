#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-actions.ts || { echo "FAIL: T018 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q 'slack' src/server/slack-actions.ts || { echo "FAIL: T018 — src/server/slack-actions.ts missing 'slack'" >&2; exit 1; }
echo "PASS: T018 — Implement src/server/slack-actions.ts"

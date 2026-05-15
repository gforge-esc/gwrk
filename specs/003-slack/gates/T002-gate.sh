#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Implement src/server/slack-messages.ts

test -f src/server/slack-messages.ts \
  || { echo "FAIL: T002 — file not found: src/server/slack-messages.ts" >&2; exit 1; }
grep -q 'specReady' src/server/slack-messages.ts \
  || { echo "FAIL: T002 — src/server/slack-messages.ts missing 'specReady'" >&2; exit 1; }
grep -q 'planReady' src/server/slack-messages.ts \
  || { echo "FAIL: T002 — src/server/slack-messages.ts missing 'planReady'" >&2; exit 1; }
echo "PASS: T002 — Implement src/server/slack-messages.ts"

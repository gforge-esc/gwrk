#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack.ts || { echo "FAIL: T040 — file not found: src/server/slack.ts" >&2; exit 1; }
grep -q 'isSlackConnected' src/server/slack.ts || { echo "FAIL: T040 — src/server/slack.ts missing 'isSlackConnected'" >&2; exit 1; }
pnpm vitest run src/server/slack.test.ts --reporter=verbose || { echo "FAIL: T040 — vitest failed for src/server/slack.test.ts" >&2; exit 1; }
echo "PASS: T040 — Implement src/server/slack.ts"
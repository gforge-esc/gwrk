#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/define.test.ts || { echo "FAIL: T041 — file not found: src/commands/define.test.ts" >&2; exit 1; }
test -f src/server/ship-bridge.test.ts || { echo "FAIL: T041 — file not found: src/server/ship-bridge.test.ts" >&2; exit 1; }
test -f src/server/slack-actions.test.ts || { echo "FAIL: T041 — file not found: src/server/slack-actions.test.ts" >&2; exit 1; }
test -f src/server/slack.test.ts || { echo "FAIL: T041 — file not found: src/server/slack.test.ts" >&2; exit 1; }
pnpm vitest run src/commands/define.test.ts --reporter=verbose || { echo "FAIL: T041 — vitest failed for src/commands/define.test.ts" >&2; exit 1; }
echo "PASS: T041 — Implement test strategy for Phase 5"
#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P10-004: No .agents/workflows/ string check in slack-agent.ts
test -f src/server/slack-agent.p10.red.test.ts \
  || { echo "FAIL: TR-P10-004 — test file not found: src/server/slack-agent.p10.red.test.ts" >&2; exit 1; }

pnpm vitest run src/server/slack-agent.p10.red.test.ts --reporter=verbose \
  || { echo "FAIL: TR-P10-004 — vitest failed for src/server/slack-agent.p10.red.test.ts" >&2; exit 1; }

echo "PASS: TR-P10-004 — No .agents/workflows/ string check in slack-agent.ts"
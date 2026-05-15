#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Implement src/server/slack-agent.ts

test -f src/server/slack-agent.ts \
  || { echo "FAIL: T006 — file not found: src/server/slack-agent.ts" >&2; exit 1; }
grep -q 'handleMention' src/server/slack-agent.ts \
  || { echo "FAIL: T006 — src/server/slack-agent.ts missing 'handleMention'" >&2; exit 1; }
echo "PASS: T006 — Implement src/server/slack-agent.ts"

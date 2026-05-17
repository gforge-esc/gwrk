#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack-commands.ts || { echo "FAIL: T014 — file not found: src/server/slack-commands.ts" >&2; exit 1; }
grep -q 'status:' src/server/slack-commands.ts || { echo "FAIL: T014 — src/server/slack-commands.ts missing 'status' handler" >&2; exit 1; }
grep -q 'ship:' src/server/slack-commands.ts || { echo "FAIL: T014 — src/server/slack-commands.ts missing 'ship' handler" >&2; exit 1; }
echo "PASS: T014 — Implement src/server/slack-commands.ts"

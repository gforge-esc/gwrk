#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack-actions.ts || { echo "FAIL: T013 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q 'merge_pr' src/server/slack-actions.ts || { echo "FAIL: T013 — src/server/slack-actions.ts missing 'merge_pr'" >&2; exit 1; }
grep -q 'retry_phase' src/server/slack-actions.ts || { echo "FAIL: T013 — src/server/slack-actions.ts missing 'retry_phase'" >&2; exit 1; }
echo "PASS: T013 — Implement src/server/slack-actions.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/slack-actions.ts || { echo "FAIL: T018 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q "merge_pr" src/server/slack-actions.ts || { echo "FAIL: T018 — src/server/slack-actions.ts missing 'merge_pr' action" >&2; exit 1; }
grep -q "retry_phase" src/server/slack-actions.ts || { echo "FAIL: T018 — src/server/slack-actions.ts missing 'retry_phase' action" >&2; exit 1; }
echo "PASS: T018 — Implement src/server/slack-actions.ts"
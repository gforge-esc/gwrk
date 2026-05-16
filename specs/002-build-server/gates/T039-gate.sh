#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack-actions.ts || { echo "FAIL: T039 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q 'approve_spec' src/server/slack-actions.ts || { echo "FAIL: T039 — src/server/slack-actions.ts missing 'approve_spec'" >&2; exit 1; }
grep -q 'approve_plan' src/server/slack-actions.ts || { echo "FAIL: T039 — src/server/slack-actions.ts missing 'approve_plan'" >&2; exit 1; }
echo "PASS: T039 — Implement src/server/slack-actions.ts"
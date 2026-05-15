#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Implement src/server/slack-actions.ts

test -f src/server/slack-actions.ts \
  || { echo "FAIL: T003 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q 'approve_spec' src/server/slack-actions.ts \
  || { echo "FAIL: T003 — src/server/slack-actions.ts missing 'approve_spec'" >&2; exit 1; }
grep -q 'approve_plan' src/server/slack-actions.ts \
  || { echo "FAIL: T003 — src/server/slack-actions.ts missing 'approve_plan'" >&2; exit 1; }
grep -q 'revise_spec' src/server/slack-actions.ts \
  || { echo "FAIL: T003 — src/server/slack-actions.ts missing 'revise_spec'" >&2; exit 1; }
echo "PASS: T003 — Implement src/server/slack-actions.ts"

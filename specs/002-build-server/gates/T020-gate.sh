#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack-actions.ts || { echo "FAIL: T020 — file not found: src/server/slack-actions.ts" >&2; exit 1; }
grep -q 'approve_spec' src/server/slack-actions.ts || { echo "FAIL: T020 — src/server/slack-actions.ts missing 'approve_spec'" >&2; exit 1; }
echo "PASS: T020 — Implement src/server/slack-actions.ts"

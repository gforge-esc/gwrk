#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack-home.ts || { echo "FAIL: T015 — file not found: src/server/slack-home.ts" >&2; exit 1; }
grep -q 'Active Agents' src/server/slack-home.ts || { echo "FAIL: T015 — src/server/slack-home.ts missing 'Active Agents' section" >&2; exit 1; }
grep -q 'Build Plan' src/server/slack-home.ts || { echo "FAIL: T015 — src/server/slack-home.ts missing 'Build Plan' section" >&2; exit 1; }
echo "PASS: T015 — Implement src/server/slack-home.ts"

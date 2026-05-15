#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/slack.ts || { echo "FAIL: T024 — file not found: src/server/slack.ts" >&2; exit 1; }
grep -q 'export async function startSlackApp' src/server/slack.ts || { echo "FAIL: T024 — src/server/slack.ts missing 'startSlackApp'" >&2; exit 1; }
echo "PASS: T024 — Implement src/server/slack.ts"

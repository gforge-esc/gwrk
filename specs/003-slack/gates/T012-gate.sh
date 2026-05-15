#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/ship.ts \
  || { echo "FAIL: T012 — file not found: src/commands/ship.ts" >&2; exit 1; }
grep -q 'SLACK_WEBHOOK_URL' src/commands/ship.ts \
  || { echo "FAIL: T012 — src/commands/ship.ts missing 'SLACK_WEBHOOK_URL'" >&2; exit 1; }

echo "PASS: T012 — Implement src/commands/ship.ts"

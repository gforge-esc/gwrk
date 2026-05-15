#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/server/slack.ts \
  || { echo "FAIL: T007 — file not found: src/server/slack.ts" >&2; exit 1; }
grep -q 'app_mention' src/server/slack.ts \
  || { echo "FAIL: T007 — src/server/slack.ts missing 'app_mention'" >&2; exit 1; }

echo "PASS: T007 — Implement src/server/slack.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Implement src/server/slack-commands.ts

test -f src/server/slack-commands.ts \
  || { echo "FAIL: T001 — file not found: src/server/slack-commands.ts" >&2; exit 1; }
grep -q 'define' src/server/slack-commands.ts \
  || { echo "FAIL: T001 — src/server/slack-commands.ts missing 'define'" >&2; exit 1; }
echo "PASS: T001 — Implement src/server/slack-commands.ts"

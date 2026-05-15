#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/index.ts || { echo "FAIL: T011 — file not found: src/server/index.ts" >&2; exit 1; }
grep -q 'startSlackApp' src/server/index.ts || { echo "FAIL: T011 — src/server/index.ts missing 'startSlackApp'" >&2; exit 1; }
echo "PASS: T011 — Implement src/server/index.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/lifecycle.ts || { echo "FAIL: T010 — file not found: src/server/lifecycle.ts" >&2; exit 1; }
grep -q "3 \* heartbeatInterval" src/server/lifecycle.ts || { echo "FAIL: T010 — src/server/lifecycle.ts missing sleep detection logic" >&2; exit 1; }
echo "PASS: T010 — Implement src/server/lifecycle.ts"
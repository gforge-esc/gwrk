#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/routes/dispatch.ts || { echo "FAIL: T006 — file not found: src/server/routes/dispatch.ts" >&2; exit 1; }
grep -q 'export async function dispatchRoutes' src/server/routes/dispatch.ts || { echo "FAIL: T006 — src/server/routes/dispatch.ts missing 'dispatchRoutes'" >&2; exit 1; }
echo "PASS: T006 — Implement src/server/routes/dispatch.ts"

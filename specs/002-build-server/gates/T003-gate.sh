#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/context.ts || { echo "FAIL: T003 — file not found: src/server/context.ts" >&2; exit 1; }
grep -q 'export function compileContext' src/server/context.ts || { echo "FAIL: T003 — src/server/context.ts missing 'compileContext'" >&2; exit 1; }
echo "PASS: T003 — Implement src/server/context.ts"

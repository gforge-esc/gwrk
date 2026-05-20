#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/index.ts || { echo "FAIL: T003 — file not found: src/server/index.ts" >&2; exit 1; }
grep -q "export async function startServer" src/server/index.ts || { echo "FAIL: T003 — src/server/index.ts missing 'startServer'" >&2; exit 1; }
echo "PASS: T003 — Implement src/server/index.ts"
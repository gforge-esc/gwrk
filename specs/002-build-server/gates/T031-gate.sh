#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/types.ts || { echo "FAIL: T031 — file not found: src/server/types.ts" >&2; exit 1; }
grep -q 'export type DispatchStatus' src/server/types.ts || { echo "FAIL: T031 — src/server/types.ts missing 'DispatchStatus'" >&2; exit 1; }
echo "PASS: T031 — Implement src/server/types.ts"

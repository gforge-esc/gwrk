#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/db/index.ts || { echo "FAIL: T023 — file not found: src/db/index.ts" >&2; exit 1; }
grep -q 'Database' src/db/index.ts || { echo "FAIL: T023 — src/db/index.ts missing 'Database'" >&2; exit 1; }
echo "PASS: T023 — Implement src/db/index.ts"

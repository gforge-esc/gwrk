#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/db/index.ts" || { echo "FAIL: T007 — file not found: src/db/index.ts" >&2; exit 1; }
grep -q "import" "src/db/index.ts" || grep -q "export" "src/db/index.ts" || { echo "FAIL: T007 — src/db/index.ts missing import/export" >&2; exit 1; }

echo "PASS: T007 — Implement src/db/index.ts"

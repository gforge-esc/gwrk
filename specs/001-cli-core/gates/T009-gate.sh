#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/db/runs.ts" || { echo "FAIL: T009 — file not found: src/db/runs.ts" >&2; exit 1; }
grep -q "import" "src/db/runs.ts" || grep -q "export" "src/db/runs.ts" || { echo "FAIL: T009 — src/db/runs.ts missing import/export" >&2; exit 1; }

echo "PASS: T009 — Implement src/db/runs.ts"

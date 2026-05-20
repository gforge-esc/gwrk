#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/history.ts" || { echo "FAIL: T024 — file not found: src/utils/history.ts" >&2; exit 1; }
grep -q "import" "src/utils/history.ts" || grep -q "export" "src/utils/history.ts" || { echo "FAIL: T024 — src/utils/history.ts missing import/export" >&2; exit 1; }

echo "PASS: T024 — Implement src/utils/history.ts"

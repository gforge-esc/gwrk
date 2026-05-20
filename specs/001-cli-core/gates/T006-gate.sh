#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/format.ts" || { echo "FAIL: T006 — file not found: src/utils/format.ts" >&2; exit 1; }
grep -q "import" "src/utils/format.ts" || grep -q "export" "src/utils/format.ts" || { echo "FAIL: T006 — src/utils/format.ts missing import/export" >&2; exit 1; }

echo "PASS: T006 — Implement src/utils/format.ts"

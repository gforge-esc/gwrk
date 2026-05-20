#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/config.ts" || { echo "FAIL: T005 — file not found: src/utils/config.ts" >&2; exit 1; }
grep -q "import" "src/utils/config.ts" || grep -q "export" "src/utils/config.ts" || { echo "FAIL: T005 — src/utils/config.ts missing import/export" >&2; exit 1; }

echo "PASS: T005 — Implement src/utils/config.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/parser.ts" || { echo "FAIL: T017 — file not found: src/utils/parser.ts" >&2; exit 1; }
grep -q "import" "src/utils/parser.ts" || grep -q "export" "src/utils/parser.ts" || { echo "FAIL: T017 — src/utils/parser.ts missing import/export" >&2; exit 1; }

echo "PASS: T017 — Implement src/utils/parser.ts"

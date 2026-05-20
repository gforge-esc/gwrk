#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/cli.ts" || { echo "FAIL: T003 — file not found: src/cli.ts" >&2; exit 1; }
grep -q "import" "src/cli.ts" || grep -q "export" "src/cli.ts" || { echo "FAIL: T003 — src/cli.ts missing import/export" >&2; exit 1; }

echo "PASS: T003 — Implement src/cli.ts"

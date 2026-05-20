#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/measure.ts" || { echo "FAIL: T047 — file not found: src/commands/measure.ts" >&2; exit 1; }
grep -q "import" "src/commands/measure.ts" || grep -q "export" "src/commands/measure.ts" || { echo "FAIL: T047 — src/commands/measure.ts missing import/export" >&2; exit 1; }

echo "PASS: T047 — Implement src/commands/measure.ts"

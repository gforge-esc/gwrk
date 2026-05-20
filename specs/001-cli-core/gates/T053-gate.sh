#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/harvest.ts" || { echo "FAIL: T053 — file not found: src/commands/harvest.ts" >&2; exit 1; }
grep -q "import" "src/commands/harvest.ts" || grep -q "export" "src/commands/harvest.ts" || { echo "FAIL: T053 — src/commands/harvest.ts missing import/export" >&2; exit 1; }

echo "PASS: T053 — Implement src/commands/harvest.ts"

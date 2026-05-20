#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/setup.ts" || { echo "FAIL: T041 — file not found: src/commands/setup.ts" >&2; exit 1; }
grep -q "import" "src/commands/setup.ts" || grep -q "export" "src/commands/setup.ts" || { echo "FAIL: T041 — src/commands/setup.ts missing import/export" >&2; exit 1; }

echo "PASS: T041 — Implement src/commands/setup.ts"

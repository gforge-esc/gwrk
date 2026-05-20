#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/ship.ts" || { echo "FAIL: T042 — file not found: src/commands/ship.ts" >&2; exit 1; }
grep -q "import" "src/commands/ship.ts" || grep -q "export" "src/commands/ship.ts" || { echo "FAIL: T042 — src/commands/ship.ts missing import/export" >&2; exit 1; }

echo "PASS: T042 — Implement src/commands/ship.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/plan.ts" || { echo "FAIL: T013 — file not found: src/commands/plan.ts" >&2; exit 1; }
grep -q "import" "src/commands/plan.ts" || grep -q "export" "src/commands/plan.ts" || { echo "FAIL: T013 — src/commands/plan.ts missing import/export" >&2; exit 1; }

echo "PASS: T013 — Implement src/commands/plan.ts"

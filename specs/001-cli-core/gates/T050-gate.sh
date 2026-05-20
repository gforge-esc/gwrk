#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/define-plan.ts" || { echo "FAIL: T050 — file not found: src/commands/define-plan.ts" >&2; exit 1; }
grep -q "import" "src/commands/define-plan.ts" || grep -q "export" "src/commands/define-plan.ts" || { echo "FAIL: T050 — src/commands/define-plan.ts missing import/export" >&2; exit 1; }

echo "PASS: T050 — Implement src/commands/define-plan.ts"

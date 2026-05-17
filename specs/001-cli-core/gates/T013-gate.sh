#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T013 — Implement src/commands/plan.ts

test -f src/commands/plan.ts \
  || { echo "FAIL: T013 — file not found: src/commands/plan.ts" >&2; exit 1; }

grep -q 'new Command("plan")' src/commands/plan.ts \
  || { echo "FAIL: T013 — src/commands/plan.ts missing 'new Command(\"plan\")'" >&2; exit 1; }

grep -q 'PlanStore' src/commands/plan.ts \
  || { echo "FAIL: T013 — src/commands/plan.ts missing 'PlanStore'" >&2; exit 1; }

echo "PASS: T013 — Implement src/commands/plan.ts"

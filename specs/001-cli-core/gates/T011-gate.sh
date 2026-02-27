#!/bin/bash
set -euo pipefail
# Gate: T011 — gwrk plan command

test -f src/commands/plan.ts
grep -q 'plan' src/commands/plan.ts
grep -q 'dispatchAgent\|agent' src/commands/plan.ts
grep -q 'spec.md\|existsSync' src/commands/plan.ts
grep -q 'plan.md\|/plan' src/commands/plan.ts

echo "PASS: T011 — plan.ts validates spec.md and dispatches /plan"

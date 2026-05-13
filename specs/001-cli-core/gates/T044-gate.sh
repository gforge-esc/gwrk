#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T044 — Implement src/commands/define-plan.ts

test -f src/commands/define-plan.ts \
  || { echo "FAIL: T044 — file not found: src/commands/define-plan.ts" >&2; exit 1; }

grep -q 'new Command("plan")' src/commands/define-plan.ts \
  || { echo "FAIL: T044 — src/commands/define-plan.ts missing 'new Command(\"plan\")'" >&2; exit 1; }

echo "PASS: T044 — Implement src/commands/define-plan.ts"

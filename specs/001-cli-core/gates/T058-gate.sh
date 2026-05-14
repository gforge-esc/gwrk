#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T058 — Implement src/commands/define-plan.ts (quiet: true)

test -f src/commands/define-plan.ts \
  || { echo "FAIL: T058 — file not found: src/commands/define-plan.ts" >&2; exit 1; }

grep -q 'runtime.executeWorkflow' src/commands/define-plan.ts \
  || { echo "FAIL: T058 — src/commands/define-plan.ts missing 'runtime.executeWorkflow'" >&2; exit 1; }

echo "PASS: T058 — Implement src/commands/define-plan.ts"

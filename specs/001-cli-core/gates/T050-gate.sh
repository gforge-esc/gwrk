#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T050 — Implement src/commands/define-plan.ts (resolveFeature)

test -f src/commands/define-plan.ts \
  || { echo "FAIL: T050 — file not found: src/commands/define-plan.ts" >&2; exit 1; }

grep -q "resolveFeature" src/commands/define-plan.ts \
  || { echo "FAIL: T050 — src/commands/define-plan.ts missing 'resolveFeature'" >&2; exit 1; }

echo "PASS: T050 — Implement src/commands/define-plan.ts (resolveFeature)"
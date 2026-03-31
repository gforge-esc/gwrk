#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/specify.test.ts \
  || { echo "FAIL: T031 — file not found: src/commands/specify.test.ts" >&2; exit 1; }

pnpm vitest run src/commands/specify.test.ts src/commands/plan.test.ts --reporter=verbose \
  || { echo "FAIL: T031 — vitest failed for CLI rewiring tests" >&2; exit 1; }

echo "PASS: T031 — CLI test verification"

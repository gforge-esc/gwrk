#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/specify.test.ts || { echo "FAIL: T036 — file not found: src/commands/specify.test.ts" >&2; exit 1; }
pnpm vitest run src/commands/specify.test.ts --reporter=verbose || { echo "FAIL: T036 — vitest failed for src/commands/specify.test.ts" >&2; exit 1; }
test -f src/commands/plan.test.ts || { echo "FAIL: T036 — file not found: src/commands/plan.test.ts" >&2; exit 1; }
pnpm vitest run src/commands/plan.test.ts --reporter=verbose || { echo "FAIL: T036 — vitest failed for src/commands/plan.test.ts" >&2; exit 1; }
echo "PASS: T036 — specify.test.ts and plan.test.ts passing"
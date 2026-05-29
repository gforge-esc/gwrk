#!/bin/bash
set -euo pipefail
# GENERATED
test -f src/commands/specify.test.ts || { echo "FAIL: T036 — file not found: src/commands/specify.test.ts" >&2; exit 1; }
pnpm vitest run src/commands/specify.test.ts --reporter=verbose || { echo "FAIL: T036 — vitest failed for src/commands/specify.test.ts" >&2; exit 1; }
test -f src/commands/define-plan.test.ts || { echo "FAIL: T036 — file not found: src/commands/define-plan.test.ts" >&2; exit 1; }
pnpm vitest run src/commands/define-plan.test.ts --reporter=verbose || { echo "FAIL: T036 — vitest failed for src/commands/define-plan.test.ts" >&2; exit 1; }
echo "PASS: T036 — Implement src/commands/specify.test.ts, define-plan.test.ts"
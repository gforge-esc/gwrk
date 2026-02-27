#!/bin/bash
set -euo pipefail
# Gate: T013 — Unit tests for agent dispatch commands (TR-002, TR-003, TR-009, TR-010)

test -f src/commands/specify.test.ts
test -f src/commands/plan.test.ts
test -f src/commands/analyze.test.ts
test -f src/commands/effort.test.ts
grep -q 'describe\|test\|it(' src/commands/specify.test.ts
grep -q 'describe\|test\|it(' src/commands/plan.test.ts
# Tests must pass
pnpm test --run src/commands/specify.test.ts src/commands/plan.test.ts src/commands/analyze.test.ts src/commands/effort.test.ts

echo "PASS: T013 — agent dispatch tests exist and pass"

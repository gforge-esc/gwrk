#!/bin/bash
set -euo pipefail
# Gate: T021 — Unit tests for task query commands (TR-005)

test -f src/commands/tasks-query.test.ts
grep -q 'describe\|test\|it(' src/commands/tasks-query.test.ts
grep -q 'list' src/commands/tasks-query.test.ts
grep -q 'next' src/commands/tasks-query.test.ts
# Tests must pass
pnpm test --run src/commands/tasks-query.test.ts

echo "PASS: T021 — task query tests exist and pass"

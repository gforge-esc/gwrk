#!/bin/bash
set -euo pipefail
# Gate: T019 — Unit tests for task engine (TR-004, TR-006, TR-007)

test -f src/commands/tasks-generate.test.ts
test -f src/commands/tasks-done.test.ts
test -f src/utils/state.test.ts
grep -q 'describe\|test\|it(' src/commands/tasks-generate.test.ts
grep -q 'describe\|test\|it(' src/commands/tasks-done.test.ts
grep -q 'describe\|test\|it(' src/utils/state.test.ts
# Tests must pass
pnpm test --run src/commands/tasks-generate.test.ts src/commands/tasks-done.test.ts src/utils/state.test.ts

echo "PASS: T019 — task engine tests exist and pass"

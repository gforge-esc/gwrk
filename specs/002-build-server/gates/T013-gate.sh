#!/usr/bin/env bash
# Gate: T013 — Unit tests for Phase 2
set -euo pipefail

# Assertion #1
test -f src/server/monitor.test.ts || { echo "FAIL: monitor.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/routes/status.test.ts || { echo "FAIL: routes/status.test.ts not found"; exit 1; }

# Assertion #3
grep -q 'describe\|test\|it(' src/server/monitor.test.ts || { echo "FAIL: monitor.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/routes/status.test.ts || { echo "FAIL: status.test.ts has no test cases"; exit 1; }

# Assertion #5
pnpm vitest run src/server/monitor.test.ts src/server/routes/status.test.ts --reporter=verbose || { echo "FAIL: Phase 2 tests failed"; exit 1; }

echo "PASS: T013"

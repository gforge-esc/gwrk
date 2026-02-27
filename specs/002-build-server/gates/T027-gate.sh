#!/usr/bin/env bash
# Gate: T027 — Unit tests for dispatch routes
set -euo pipefail

# Assertion #1
test -f src/server/routes/dispatch.test.ts || { echo "FAIL: routes/dispatch.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/routes/dispatch.test.ts || { echo "FAIL: dispatch.test.ts has no test cases"; exit 1; }

# Assertion #3
pnpm vitest run src/server/routes/dispatch.test.ts --reporter=verbose || { echo "FAIL: dispatch route tests failed"; exit 1; }

echo "PASS: T027"

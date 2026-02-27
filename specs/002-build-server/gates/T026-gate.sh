#!/usr/bin/env bash
# Gate: T026 — Unit tests for dispatch queue
set -euo pipefail

# Assertion #1
test -f src/server/dispatch.test.ts || { echo "FAIL: dispatch.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/dispatch.test.ts || { echo "FAIL: dispatch.test.ts has no test cases"; exit 1; }

# Verify retry test coverage
# Assertion #3
grep -q 'retry\|escalat\|fallback' src/server/dispatch.test.ts || { echo "FAIL: retry/escalation test cases missing"; exit 1; }

# Assertion #4
pnpm vitest run src/server/dispatch.test.ts --reporter=verbose || { echo "FAIL: dispatch queue tests failed"; exit 1; }

echo "PASS: T026"

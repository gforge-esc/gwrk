#!/usr/bin/env bash
# Gate: T007 — Unit tests for Phase 1
set -euo pipefail

# Test files must exist
# Assertion #1
test -f src/commands/server.test.ts || { echo "FAIL: src/commands/server.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/index.test.ts || { echo "FAIL: src/server/index.test.ts not found"; exit 1; }

# Tests must contain meaningful assertions
# Assertion #3
grep -q 'describe\|test\|it(' src/commands/server.test.ts || { echo "FAIL: server.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/index.test.ts || { echo "FAIL: index.test.ts has no test cases"; exit 1; }

# Tests must pass
# Assertion #5
pnpm vitest run src/commands/server.test.ts src/server/index.test.ts --reporter=verbose || { echo "FAIL: Phase 1 tests failed"; exit 1; }

echo "PASS: T007"

#!/usr/bin/env bash
# Gate: T021 — Unit tests for Phase 4
set -euo pipefail

# Assertion #1
test -f src/server/sandbox.test.ts || { echo "FAIL: sandbox.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/sandbox.test.ts || { echo "FAIL: sandbox.test.ts has no test cases"; exit 1; }

# Assertion #3
pnpm vitest run src/server/sandbox.test.ts --reporter=verbose || { echo "FAIL: Phase 4 tests failed"; exit 1; }

echo "PASS: T021"

#!/usr/bin/env bash
# Gate: T017 — Unit tests for Phase 3
set -euo pipefail

# Assertion #1
test -f src/server/git-manager.test.ts || { echo "FAIL: git-manager.test.ts not found"; exit 1; }
# Assertion #2
test -f src/server/context.test.ts || { echo "FAIL: context.test.ts not found"; exit 1; }

# Assertion #3
grep -q 'describe\|test\|it(' src/server/git-manager.test.ts || { echo "FAIL: git-manager.test.ts has no test cases"; exit 1; }
# Assertion #4
grep -q 'describe\|test\|it(' src/server/context.test.ts || { echo "FAIL: context.test.ts has no test cases"; exit 1; }

# Assertion #5
pnpm vitest run src/server/git-manager.test.ts src/server/context.test.ts --reporter=verbose || { echo "FAIL: Phase 3 tests failed"; exit 1; }

echo "PASS: T017"

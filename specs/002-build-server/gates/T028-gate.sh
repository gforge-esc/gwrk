#!/usr/bin/env bash
# Gate: T028 — Integration test for end-to-end dispatch
set -euo pipefail

# Assertion #1
test -f src/server/integration.test.ts || { echo "FAIL: integration.test.ts not found"; exit 1; }

# Assertion #2
grep -q 'describe\|test\|it(' src/server/integration.test.ts || { echo "FAIL: integration.test.ts has no test cases"; exit 1; }

# Verify integration test references the full lifecycle
# Assertion #3
grep -q 'dispatch\|POST\|/api/dispatch' src/server/integration.test.ts || { echo "FAIL: dispatch endpoint not tested in integration test"; exit 1; }

# Assertion #4
pnpm vitest run src/server/integration.test.ts --reporter=verbose || { echo "FAIL: integration test failed"; exit 1; }

echo "PASS: T028"

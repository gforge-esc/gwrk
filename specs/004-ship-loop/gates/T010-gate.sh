#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Implement src/scripts-e2e.test.ts

FILE="src/scripts-e2e.test.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Tests for circuit-break failureContext exist
grep -q "describe(\"FR-018/T007: Circuit Breaker failureContext\"" "$FILE"
grep -q "produces non-empty failureContext in the JSON state file on CIRCUIT_BREAK" "$FILE"

# Assertion 3: Tests for dirty-tree guard exist
grep -q "describe(\"FR-002/T005: wud-branch.sh dirty-tree guard\"" "$FILE"
grep -q "exits 1 if the working tree is dirty" "$FILE"

# Assertion 4: Run the tests
pnpm vitest run "$FILE" --reporter=verbose

echo "PASS: T010 — src/scripts-e2e.test.ts Phase 2 features verified"

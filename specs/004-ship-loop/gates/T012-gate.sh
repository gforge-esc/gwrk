#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T012 — Implement Phase 3 tests in src/commands/ship.test.ts

FILE="src/commands/ship.test.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Tests for agent config resolution exist
grep -q "describe(\"FR-009/T010: Agent config fail-fast\"" "$FILE"

# Assertion 3: Tests for Agent-Native output exist
grep -q "describe(\"FR-015/T008: Agent-Native \[exit:N | Xs\] wrapper\"" "$FILE"

# Assertion 4: Tests for --format json exist
grep -q "describe(\"FR-015/T009: --format json support\"" "$FILE"

# Assertion 5: Run the tests
pnpm vitest run "$FILE" --reporter=verbose

echo "PASS: T012 — src/commands/ship.test.ts Phase 3 features verified"

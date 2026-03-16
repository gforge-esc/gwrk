#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T013 — Implement Phase 3 tests in src/scripts-e2e.test.ts

FILE="src/scripts-e2e.test.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Tests for full execution loop exist
grep -q "should complete a full execution loop without unbound variables" "$FILE"

# Assertion 3: Tests for pre-flight gates exist
grep -q "FR-003/T004: should run pre-flight tasks.json gates before implementation" "$FILE"

# Assertion 4: Run the tests
pnpm vitest run "$FILE" --reporter=verbose

echo "PASS: T013 — src/scripts-e2e.test.ts Phase 3 features verified"

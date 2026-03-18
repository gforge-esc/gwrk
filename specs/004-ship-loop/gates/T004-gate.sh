#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Implement src/commands/ship.test.ts

FILE="src/commands/ship.test.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Tests for phase-skip exist
grep -q "describe(\"FR-014: Phase Skip\"" "$FILE"
grep -q "US-009: should skip phase when all tasks have status 'completed'" "$FILE"
grep -q "US-009: should skip phase when all tasks are either 'completed' or 'cancelled'" "$FILE"

# Assertion 3: Tests for digest assembly exist
grep -q "describe(\"FR-012, FR-017/T003: Execution Manifest Digest\"" "$FILE"
grep -q "US-007/T003: writeManifest receives a manifest object with digest array" "$FILE"

# Assertion 4: Run the tests
pnpm vitest run "$FILE" --reporter=verbose

echo "PASS: T004 — src/commands/ship.test.ts implementation verified"

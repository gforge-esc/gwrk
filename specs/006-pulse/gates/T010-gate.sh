#!/usr/bin/env bash
# Gate: T010 — Pulse config tests
set -euo pipefail

FILE="src/utils/config.test.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: pulse config tested
grep -q "pulse" "$FILE" || { echo "FAIL #2: pulse config tests missing"; exit 1; }

# Assertion #3: repos field tested
grep -q "repos" "$FILE" || { echo "FAIL #3: repos field test missing"; exit 1; }

# Assertion #4: Tests pass
npx vitest run src/utils/config.test.ts --reporter=verbose 2>&1 || { echo "FAIL #4: config tests did not pass"; exit 1; }

echo "PASS: T010"

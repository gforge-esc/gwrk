#!/usr/bin/env bash
# Gate: T003 — Git helper unit tests
set -euo pipefail

FILE="src/utils/git.test.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: detectDefaultBranch tests present
grep -q "detectDefaultBranch" "$FILE" || { echo "FAIL #2: detectDefaultBranch tests missing"; exit 1; }

# Assertion #3: master fallback test present
grep -q "master" "$FILE" || { echo "FAIL #3: master fallback test missing"; exit 1; }

# Assertion #4: Tests pass
npx vitest run src/utils/git.test.ts --reporter=verbose 2>&1 || { echo "FAIL #4: git helper tests did not pass"; exit 1; }

echo "PASS: T003"

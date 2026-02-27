#!/usr/bin/env bash
# Gate: T007 — Pulse engine unit tests
set -euo pipefail

FILE="src/engine/pulse.test.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: parseGitLog tests present
grep -q "parseGitLog" "$FILE" || { echo "FAIL #2: parseGitLog tests missing"; exit 1; }

# Assertion #3: bucketByWeek tests present
grep -q "bucketByWeek" "$FILE" || { echo "FAIL #3: bucketByWeek tests missing"; exit 1; }

# Assertion #4: mainLoc separation tested
grep -q "mainLoc" "$FILE" || { echo "FAIL #4: mainLoc separation tests missing"; exit 1; }

# Assertion #5: draftLoc separation tested
grep -q "draftLoc" "$FILE" || { echo "FAIL #5: draftLoc separation tests missing"; exit 1; }

# Assertion #6: Tests pass
npx vitest run src/engine/pulse.test.ts --reporter=verbose 2>&1 || { echo "FAIL #6: pulse engine tests did not pass"; exit 1; }

echo "PASS: T007"

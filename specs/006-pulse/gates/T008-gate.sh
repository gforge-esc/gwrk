#!/usr/bin/env bash
# Gate: T008 — Pulse engine integration test
set -euo pipefail

FILE="src/engine/pulse-integration.test.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: Creates real git repo
grep -q "git init" "$FILE" || grep -q "execSync.*init" "$FILE" || { echo "FAIL #2: real git repo creation not found"; exit 1; }

# Assertion #3: weeklyBuckets assertion
grep -q "weeklyBuckets" "$FILE" || { echo "FAIL #3: weeklyBuckets assertion missing"; exit 1; }

# Assertion #4: mainLoc assertion
grep -q "mainLoc" "$FILE" || { echo "FAIL #4: mainLoc assertion missing"; exit 1; }

# Assertion #5: Tests pass
npx vitest run src/engine/pulse-integration.test.ts --reporter=verbose 2>&1 || { echo "FAIL #5: integration tests did not pass"; exit 1; }

echo "PASS: T008"

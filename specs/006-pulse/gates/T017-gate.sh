#!/usr/bin/env bash
# Gate: T017 — Wire multi-repo report into gwrk pulse command
set -euo pipefail

FILE="src/commands/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: Calls generatePulseReport
grep -q "generatePulseReport" "$FILE" || { echo "FAIL #2: generatePulseReport not called in pulse command"; exit 1; }

# Assertion #3: renderPulseTable function exists
grep -q "renderPulseTable\|function.*render.*Table\|function.*format.*Report" "$FILE" || { echo "FAIL #3: renderPulseTable not found"; exit 1; }

# Assertion #4: TypeScript compiles
npx tsc --noEmit 2>&1 || { echo "FAIL #4: TypeScript compilation failed"; exit 1; }

echo "PASS: T017"

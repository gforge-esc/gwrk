#!/usr/bin/env bash
# Gate: T016 — generatePulseReport multi-repo aggregation
set -euo pipefail

FILE="src/engine/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: generatePulseReport exported
grep -q "export.*function generatePulseReport" "$FILE" || { echo "FAIL #2: generatePulseReport not exported"; exit 1; }

# Assertion #3: Returns PulseReport type
grep -q "PulseReport" "$FILE" || { echo "FAIL #3: PulseReport type not referenced"; exit 1; }

# Assertion #4: Calls scanRepository
grep -q "scanRepository" "$FILE" || { echo "FAIL #4: scanRepository not called in generatePulseReport"; exit 1; }

# Assertion #5: Calls scanSpecProgress
grep -q "scanSpecProgress" "$FILE" || { echo "FAIL #5: scanSpecProgress not called"; exit 1; }

echo "PASS: T016"

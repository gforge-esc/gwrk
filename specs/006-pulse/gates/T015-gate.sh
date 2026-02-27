#!/usr/bin/env bash
# Gate: T015 — scanSpecProgress
set -euo pipefail

FILE="src/engine/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: scanSpecProgress exported
grep -q "export.*function scanSpecProgress" "$FILE" || { echo "FAIL #2: scanSpecProgress not exported"; exit 1; }

# Assertion #3: Returns SpecProgress type
grep -q "SpecProgress" "$FILE" || { echo "FAIL #3: SpecProgress type not referenced"; exit 1; }

# Assertion #4: Scans spec.md files
grep -q "spec.md\|spec\.md" "$FILE" || { echo "FAIL #4: spec.md scanning not found"; exit 1; }

echo "PASS: T015"

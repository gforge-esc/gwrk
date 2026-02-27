#!/usr/bin/env bash
# Gate: T006 — scanRepository entry point
set -euo pipefail

FILE="src/engine/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: scanRepository exported
grep -q "export.*function scanRepository" "$FILE" || { echo "FAIL #2: scanRepository not exported"; exit 1; }

# Assertion #3: PulseSnapshot type referenced
grep -q "PulseSnapshot" "$FILE" || { echo "FAIL #3: PulseSnapshot type not referenced"; exit 1; }

# Assertion #4: Calls detectDefaultBranch
grep -q "detectDefaultBranch" "$FILE" || { echo "FAIL #4: detectDefaultBranch not called"; exit 1; }

# Assertion #5: Calls parseGitLog
grep -q "parseGitLog" "$FILE" || { echo "FAIL #5: parseGitLog not called"; exit 1; }

# Assertion #6: Calls bucketByWeek
grep -q "bucketByWeek" "$FILE" || { echo "FAIL #6: bucketByWeek not called"; exit 1; }

# Assertion #7: Validates with Zod schema
grep -q "Schema" "$FILE" || { echo "FAIL #7: Zod schema validation not found"; exit 1; }

echo "PASS: T006"

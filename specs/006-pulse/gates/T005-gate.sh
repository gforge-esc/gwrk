#!/usr/bin/env bash
# Gate: T005 — bucketByWeek weekly grouping
set -euo pipefail

FILE="src/engine/pulse.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: bucketByWeek exported
grep -q "export.*function bucketByWeek" "$FILE" || { echo "FAIL #2: bucketByWeek not exported"; exit 1; }

# Assertion #3: WeeklyBucket type referenced
grep -q "WeeklyBucket" "$FILE" || { echo "FAIL #3: WeeklyBucket type not referenced"; exit 1; }

# Assertion #4: weekStart field used
grep -q "weekStart" "$FILE" || { echo "FAIL #4: weekStart not found in bucketing logic"; exit 1; }

# Assertion #5: added field tracked
grep -q "added" "$FILE" || { echo "FAIL #5: added field not found"; exit 1; }

# Assertion #6: deleted field tracked
grep -q "deleted" "$FILE" || { echo "FAIL #6: deleted field not found"; exit 1; }

echo "PASS: T005"

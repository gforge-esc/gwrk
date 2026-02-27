#!/usr/bin/env bash
# Gate: T001 — Pulse type definitions and Zod schemas
set -euo pipefail

FILE="src/engine/types.ts"

# Assertion #1: File exists
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist"; exit 1; }

# Assertion #2: PulseSnapshot exported
grep -q "export.*PulseSnapshot" "$FILE" || { echo "FAIL #2: PulseSnapshot not exported"; exit 1; }

# Assertion #3: WeeklyBucket exported
grep -q "export.*WeeklyBucket" "$FILE" || { echo "FAIL #3: WeeklyBucket not exported"; exit 1; }

# Assertion #4: PulseReport exported
grep -q "export.*PulseReport" "$FILE" || { echo "FAIL #4: PulseReport not exported"; exit 1; }

# Assertion #5: SpecProgress exported
grep -q "export.*SpecProgress" "$FILE" || { echo "FAIL #5: SpecProgress not exported"; exit 1; }

# Assertion #6: PulseSnapshotSchema Zod schema
grep -q "PulseSnapshotSchema" "$FILE" || { echo "FAIL #6: PulseSnapshotSchema not found"; exit 1; }

# Assertion #7: WeeklyBucketSchema Zod schema
grep -q "WeeklyBucketSchema" "$FILE" || { echo "FAIL #7: WeeklyBucketSchema not found"; exit 1; }

# Assertion #8: weekStart field
grep -q "weekStart" "$FILE" || { echo "FAIL #8: weekStart field not found"; exit 1; }

# Assertion #9: mainLoc field
grep -q "mainLoc" "$FILE" || { echo "FAIL #9: mainLoc field not found"; exit 1; }

# Assertion #10: draftLoc field
grep -q "draftLoc" "$FILE" || { echo "FAIL #10: draftLoc field not found"; exit 1; }

echo "PASS: T001"

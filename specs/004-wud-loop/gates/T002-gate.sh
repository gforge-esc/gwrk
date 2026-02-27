#!/usr/bin/env bash
# Gate: T002 — Create WUD state persistence utility
# Contract: contracts/wud.md (state persistence section)
set -euo pipefail

FILE="src/utils/wud-state.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export saveWudState
grep -q 'export.*function saveWudState' "$FILE" || \
  { echo "FAIL #2: saveWudState() not exported from $FILE" >&2; exit 1; }

# #3 Must export loadWudState
grep -q 'export.*function loadWudState' "$FILE" || \
  { echo "FAIL #3: loadWudState() not exported from $FILE" >&2; exit 1; }

# #4 Must define WudState type or interface
grep -qE 'export.*(type|interface) WudState' "$FILE" || \
  { echo "FAIL #4: WudState type not exported from $FILE" >&2; exit 1; }

# #5 Must use Zod for validation
grep -q 'z\.\|zod' "$FILE" || \
  { echo "FAIL #5: Must use Zod for WudState validation" >&2; exit 1; }

# #6 Must handle all stage enum values
grep -q 'BRANCH_SETUP' "$FILE" && \
grep -q 'IMPLEMENTING' "$FILE" && \
grep -q 'CIRCUIT_BREAK' "$FILE" || \
  { echo "FAIL #6: Must define all WudStage enum values" >&2; exit 1; }

echo "PASS: T002 — wud-state.ts exports saveWudState(), loadWudState(), WudState"

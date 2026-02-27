#!/usr/bin/env bash
# Gate: T006 — Create verdict checker utility
# Contract: contracts/verdict.md
set -euo pipefail

FILE="src/utils/verdict.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export checkPhaseVerdict
grep -qE 'export.*function checkPhaseVerdict' "$FILE" || \
  { echo "FAIL #2: checkPhaseVerdict() not exported from $FILE" >&2; exit 1; }

# #3 Must define VerdictResult type
grep -qE '(type|interface) VerdictResult' "$FILE" || \
  { echo "FAIL #3: VerdictResult type not defined" >&2; exit 1; }

# #4 Must use GO/NO-GO verdict values
grep -q '"GO"\|"NO-GO"' "$FILE" || \
grep -q "'GO'\|'NO-GO'" "$FILE" || \
  { echo "FAIL #4: Must use GO/NO-GO verdict values" >&2; exit 1; }

# #5 Must import loadTaskState
grep -q 'loadTaskState' "$FILE" || \
  { echo "FAIL #5: Must import loadTaskState to read tasks.json" >&2; exit 1; }

echo "PASS: T006 — verdict.ts exports checkPhaseVerdict() with VerdictResult"

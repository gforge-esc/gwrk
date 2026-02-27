#!/usr/bin/env bash
# Gate: T008 — Create WUD command — state machine orchestrator
# Contract: contracts/wud.md
set -euo pipefail

FILE="src/commands/wud.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export runWudLoop
grep -qE 'export.*(async )?function runWudLoop' "$FILE" || \
  { echo "FAIL #2: runWudLoop() not exported from $FILE" >&2; exit 1; }

# #3 Must be a Commander command
grep -q 'Command\|program\|command(' "$FILE" || \
  { echo "FAIL #3: Must be a Commander command" >&2; exit 1; }

# #4 Must implement BRANCH_SETUP stage
grep -q 'BRANCH_SETUP' "$FILE" || \
  { echo "FAIL #4: Must implement BRANCH_SETUP stage" >&2; exit 1; }

# #5 Must implement IMPLEMENTING stage
grep -q 'IMPLEMENTING' "$FILE" || \
  { echo "FAIL #5: Must implement IMPLEMENTING stage" >&2; exit 1; }

# #6 Must implement CODE_REVIEW stage
grep -q 'CODE_REVIEW' "$FILE" || \
  { echo "FAIL #6: Must implement CODE_REVIEW stage" >&2; exit 1; }

# #7 Must implement UAT_REVIEW stage
grep -q 'UAT_REVIEW' "$FILE" || \
  { echo "FAIL #7: Must implement UAT_REVIEW stage" >&2; exit 1; }

# #8 Must implement PR_CI stage
grep -q 'PR_CI' "$FILE" || \
  { echo "FAIL #8: Must implement PR_CI stage" >&2; exit 1; }

# #9 Must implement DONE stage
grep -q 'DONE' "$FILE" || \
  { echo "FAIL #9: Must implement DONE stage" >&2; exit 1; }

# #10 Must implement circuit breaker
grep -q 'CIRCUIT_BREAK\|circuit.*break\|maxIterations\|MAX_ITERATIONS' "$FILE" || \
  { echo "FAIL #10: Must implement circuit breaker" >&2; exit 1; }

# #11 Must import executePhase
grep -q 'executePhase' "$FILE" || \
  { echo "FAIL #11: Must import executePhase from implement.ts" >&2; exit 1; }

# #12 Must import state persistence
grep -q 'saveWudState\|loadWudState' "$FILE" || \
  { echo "FAIL #12: Must import state persistence functions" >&2; exit 1; }

# #13 Must import createPR
grep -q 'createPR' "$FILE" || \
  { echo "FAIL #13: Must import createPR from pr.ts" >&2; exit 1; }

# #14 Must import checkPhaseVerdict
grep -q 'checkPhaseVerdict' "$FILE" || \
  { echo "FAIL #14: Must import checkPhaseVerdict from verdict.ts" >&2; exit 1; }

echo "PASS: T008 — wud.ts exports runWudLoop() with full state machine"

#!/usr/bin/env bash
# Gate: T004 — Create implement command — task loop and gate enforcement
# Contract: contracts/implement.md
set -euo pipefail

FILE="src/commands/implement.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export executePhase function
grep -qE 'export.*(async )?function executePhase' "$FILE" || \
  { echo "FAIL #2: executePhase() not exported from $FILE" >&2; exit 1; }

# #3 Must be a Commander command
grep -q 'Command\|program\|command(' "$FILE" || \
  { echo "FAIL #3: Must be a Commander command" >&2; exit 1; }

# #4 Must import loadTaskState from state utils
grep -q 'loadTaskState' "$FILE" || \
  { echo "FAIL #4: Must import loadTaskState from state.ts" >&2; exit 1; }

# #5 Must import dispatchAgent from agent utils
grep -q 'dispatchAgent' "$FILE" || \
  { echo "FAIL #5: Must import dispatchAgent from agent.ts" >&2; exit 1; }

# #6 Must import runGate from exec utils
grep -q 'runGate' "$FILE" || \
  { echo "FAIL #6: Must import runGate from exec.ts" >&2; exit 1; }

# #7 Must import ensureBranch from branch utils
grep -q 'ensureBranch' "$FILE" || \
  { echo "FAIL #7: Must import ensureBranch from branch.ts" >&2; exit 1; }

# #8 Must implement pre-flight gate check
grep -q 'pre.*[Ff]light\|preFlight\|pre_flight' "$FILE" || \
  { echo "FAIL #8: Must implement pre-flight gate check" >&2; exit 1; }

# #9 Must commit per task
grep -q 'git.*commit\|execFileSync.*commit' "$FILE" || \
grep -q "'commit'" "$FILE" || \
  { echo "FAIL #9: Must create a commit per task" >&2; exit 1; }

echo "PASS: T004 — implement.ts exports executePhase() with task loop, gates, and commits"

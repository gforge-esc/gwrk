#!/usr/bin/env bash
# Gate: T005 — Create implement command unit tests
# Contract: contracts/implement.md (TR-001, TR-002, TR-003, TR-009)
set -euo pipefail

FILE="src/commands/implement.test.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must import from implement module
grep -q 'implement' "$FILE" || \
  { echo "FAIL #2: Must import from implement module" >&2; exit 1; }

# #3 Must test task loop / executePhase
grep -q 'task loop\|iterates.*tasks\|all.*phase.*tasks' "$FILE" || \
grep -q 'executePhase' "$FILE" || \
  { echo "FAIL #3: Must test task loop iteration" >&2; exit 1; }

# #4 Must test pre-flight gate skip
grep -q 'pre.*[Ff]light\|skip\|already.*pass' "$FILE" || \
  { echo "FAIL #4: Must test pre-flight gate skip behavior" >&2; exit 1; }

# #5 Must test branch creation
grep -q 'branch\|ensureBranch' "$FILE" || \
  { echo "FAIL #5: Must test branch creation" >&2; exit 1; }

# #6 Must use mock/vi.mock
grep -q 'vi\.\|mock\|jest\.' "$FILE" || \
  { echo "FAIL #6: Must mock dependencies" >&2; exit 1; }

# #7 Tests must pass
npx vitest run src/commands/implement.test.ts --reporter=verbose 2>&1 || \
  { echo "FAIL #7: implement.test.ts tests did not pass" >&2; exit 1; }

echo "PASS: T005 — implement.test.ts exists and all tests pass"

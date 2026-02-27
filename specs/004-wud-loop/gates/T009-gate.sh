#!/usr/bin/env bash
# Gate: T009 — Create WUD command unit tests
# Contract: contracts/wud.md (TR-004 through TR-008, TR-010)
set -euo pipefail

FILE="src/commands/wud.test.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must import from wud module
grep -q 'wud\|runWudLoop' "$FILE" || \
  { echo "FAIL #2: Must import from wud module" >&2; exit 1; }

# #3 Must test state machine transitions
grep -q 'BRANCH_SETUP\|state machine\|transition' "$FILE" || \
  { echo "FAIL #3: Must test state machine transitions" >&2; exit 1; }

# #4 Must test circuit breaker
grep -q 'circuit\|CIRCUIT_BREAK\|max.*iteration' "$FILE" || \
  { echo "FAIL #4: Must test circuit breaker" >&2; exit 1; }

# #5 Must test crash recovery
grep -q 'resume\|crash\|recovery\|loadWudState' "$FILE" || \
  { echo "FAIL #5: Must test crash recovery" >&2; exit 1; }

# #6 Must test NO-GO loop back
grep -q 'NO-GO\|NO_GO\|loop.*back\|retry' "$FILE" || \
  { echo "FAIL #6: Must test NO-GO loop back to IMPLEMENTING" >&2; exit 1; }

# #7 Must use mock/vi.mock
grep -q 'vi\.\|mock\|jest\.' "$FILE" || \
  { echo "FAIL #7: Must mock dependencies" >&2; exit 1; }

# #8 Tests must pass
npx vitest run src/commands/wud.test.ts --reporter=verbose 2>&1 || \
  { echo "FAIL #8: wud.test.ts tests did not pass" >&2; exit 1; }

echo "PASS: T009 — wud.test.ts exists and all tests pass"

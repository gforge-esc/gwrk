#!/usr/bin/env bash
# Gate: T007 — Create PR + CI gate utility
# Contract: contracts/pr.md
set -euo pipefail

FILE="src/utils/pr.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export createPR
grep -qE 'export.*(async )?function createPR' "$FILE" || \
  { echo "FAIL #2: createPR() not exported from $FILE" >&2; exit 1; }

# #3 Must export waitForCI
grep -qE 'export.*(async )?function waitForCI' "$FILE" || \
  { echo "FAIL #3: waitForCI() not exported from $FILE" >&2; exit 1; }

# #4 Must use gh CLI for PR operations
grep -q "'gh'\|\"gh\"\|gh pr" "$FILE" || \
  { echo "FAIL #4: Must use gh CLI for PR operations" >&2; exit 1; }

# #5 Must target develop branch
grep -q 'develop' "$FILE" || \
  { echo "FAIL #5: PR must target develop branch" >&2; exit 1; }

# #6 Must handle timeout
grep -q 'timeout\|Timeout\|TIMEOUT' "$FILE" || \
  { echo "FAIL #6: Must handle CI timeout" >&2; exit 1; }

echo "PASS: T007 — pr.ts exports createPR() and waitForCI() using gh CLI"

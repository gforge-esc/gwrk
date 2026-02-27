#!/usr/bin/env bash
# Gate: T001 — Create branch management utility
# Contract: contracts/branch.md
set -euo pipefail

FILE="src/utils/branch.ts"

# #1 File must exist
test -f "$FILE" || { echo "FAIL #1: $FILE does not exist" >&2; exit 1; }

# #2 Must export ensureBranch function
grep -q 'export.*function ensureBranch' "$FILE" || \
grep -q 'export async function ensureBranch' "$FILE" || \
  { echo "FAIL #2: ensureBranch() not exported from $FILE" >&2; exit 1; }

# #3 Must export pushBranch function
grep -q 'export.*function pushBranch' "$FILE" || \
grep -q 'export async function pushBranch' "$FILE" || \
  { echo "FAIL #3: pushBranch() not exported from $FILE" >&2; exit 1; }

# #4 Must accept featureName parameter
grep -q 'featureName.*string' "$FILE" || \
  { echo "FAIL #4: ensureBranch must accept featureName: string" >&2; exit 1; }

# #5 Must use child_process for git commands
grep -q 'execFileSync\|execFile\|exec(' "$FILE" || \
grep -q 'child_process' "$FILE" || \
  { echo "FAIL #5: Must use child_process for git commands" >&2; exit 1; }

# #6 Must reference 'develop' branch
grep -q 'develop' "$FILE" || \
  { echo "FAIL #6: Must reference develop branch" >&2; exit 1; }

echo "PASS: T001 — branch.ts exports ensureBranch() and pushBranch()"

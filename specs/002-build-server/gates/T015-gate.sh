#!/usr/bin/env bash
# Gate: T015 — Create Git branch manager
# Contract: src/server/git-manager.ts must export createPhaseBranch, mergePhaseBack, isClean, hasConflicts
set -euo pipefail

FILE="src/server/git-manager.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function createPhaseBranch\|export async function createPhaseBranch' "$FILE" || { echo "FAIL: createPhaseBranch not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function mergePhaseBack\|export async function mergePhaseBack' "$FILE" || { echo "FAIL: mergePhaseBack not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function isClean\|export async function isClean' "$FILE" || { echo "FAIL: isClean not exported"; exit 1; }
# Assertion #5
grep -q 'export.*function hasConflicts\|export async function hasConflicts' "$FILE" || { echo "FAIL: hasConflicts not exported"; exit 1; }

# Verify git operations via child_process
# Assertion #6
grep -q 'execFile\|exec\|child_process' "$FILE" || { echo "FAIL: child_process not used for git operations"; exit 1; }

echo "PASS: T015"

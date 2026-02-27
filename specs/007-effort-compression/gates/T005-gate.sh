#!/usr/bin/env bash
# Gate: T005 — Create effort computation engine
# Contract: src/engine/effort.ts must export computeEffort()
set -euo pipefail

FILE="src/engine/effort.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function computeEffort' "$FILE" || \
# Assertion #3
grep -q 'export function computeEffort' "$FILE" || \
  { echo "FAIL: computeEffort function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'EffortReport' "$FILE" || { echo "FAIL: EffortReport return type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'StoryEstimate' "$FILE" || { echo "FAIL: StoryEstimate parameter type not referenced" >&2; exit 1; }
# Assertion #6
grep -q 'RoleConfig' "$FILE" || { echo "FAIL: RoleConfig parameter type not referenced" >&2; exit 1; }
# Assertion #7
grep -q 'overheadFactor' "$FILE" || { echo "FAIL: overheadFactor parameter not found" >&2; exit 1; }

echo "PASS: T005 — effort engine exports computeEffort with correct types"

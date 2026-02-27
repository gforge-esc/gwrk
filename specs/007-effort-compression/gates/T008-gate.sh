#!/usr/bin/env bash
# Gate: T008 — Create git timestamp collector
# Contract: src/engine/git-timestamps.ts must export collectTimestamps()
set -euo pipefail

FILE="src/engine/git-timestamps.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function collectTimestamps' "$FILE" || \
# Assertion #3
grep -q 'export function collectTimestamps' "$FILE" || \
  { echo "FAIL: collectTimestamps function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'DeliveryActuals' "$FILE" || { echo "FAIL: DeliveryActuals return type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'git log' "$FILE" || { echo "FAIL: git log invocation not found" >&2; exit 1; }
# Assertion #6
grep -q 'No implementation commits found' "$FILE" || { echo "FAIL: missing error message for no impl commits" >&2; exit 1; }

echo "PASS: T008 — git timestamp collector exports collectTimestamps"

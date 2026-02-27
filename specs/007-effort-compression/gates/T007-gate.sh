#!/usr/bin/env bash
# Gate: T007 — Create effort engine tests
# Contract: tests must exist and pass
set -euo pipefail

FILE="src/engine/effort.test.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'computeEffort' "$FILE" || { echo "FAIL: test file does not reference computeEffort" >&2; exit 1; }
# Assertion #3
grep -q '1.25' "$FILE" || grep -q 'overhead' "$FILE" || { echo "FAIL: missing overhead factor test" >&2; exit 1; }

# Assertion #4
pnpm vitest run src/engine/effort.test.ts --reporter=verbose 2>&1 || { echo "FAIL: effort engine tests failed" >&2; exit 1; }

echo "PASS: T007 — effort engine tests pass"

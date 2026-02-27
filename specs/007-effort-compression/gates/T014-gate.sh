#!/usr/bin/env bash
# Gate: T014 — Create compression engine tests
# Contract: tests must exist and pass
set -euo pipefail

FILE="src/engine/compression.test.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'computeCompression' "$FILE" || { echo "FAIL: test file does not reference computeCompression" >&2; exit 1; }
# Assertion #3
grep -q 'generateSummary' "$FILE" || { echo "FAIL: test file does not reference generateSummary" >&2; exit 1; }
# Assertion #4
grep -q '383' "$FILE" || { echo "FAIL: missing 383× point compression test case" >&2; exit 1; }

# Assertion #5
pnpm vitest run src/engine/compression.test.ts --reporter=verbose 2>&1 || { echo "FAIL: compression engine tests failed" >&2; exit 1; }

echo "PASS: T014 — compression engine tests pass"

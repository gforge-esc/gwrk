#!/usr/bin/env bash
# Gate: T009 — Create git timestamp collector tests
# Contract: tests must exist and pass
set -euo pipefail

FILE="src/engine/git-timestamps.test.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'collectTimestamps' "$FILE" || { echo "FAIL: test file does not reference collectTimestamps" >&2; exit 1; }

# Assertion #3
pnpm vitest run src/engine/git-timestamps.test.ts --reporter=verbose 2>&1 || { echo "FAIL: git-timestamps tests failed" >&2; exit 1; }

echo "PASS: T009 — git timestamp collector tests pass"

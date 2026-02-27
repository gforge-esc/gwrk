#!/usr/bin/env bash
# Gate: T003 — Create spec parser tests
# Contract: tests must exist and pass
set -euo pipefail

FILE="src/engine/spec-parser.test.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'extractStories' "$FILE" || { echo "FAIL: test file does not reference extractStories" >&2; exit 1; }
# Assertion #3
grep -q 'spec.md not found' "$FILE" || grep -q 'not found' "$FILE" || { echo "FAIL: missing test for spec not found error" >&2; exit 1; }

# Assertion #4
pnpm vitest run src/engine/spec-parser.test.ts --reporter=verbose 2>&1 || { echo "FAIL: spec-parser tests failed" >&2; exit 1; }

echo "PASS: T003 — spec parser tests pass"

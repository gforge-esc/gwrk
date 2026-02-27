#!/usr/bin/env bash
# Gate: T019 — Create CLI command tests
# Contract: tests must exist and pass
set -euo pipefail

FILE1="src/commands/effort.test.ts"
FILE2="src/commands/compression.test.ts"

# Assertion #1
test -f "$FILE1" || { echo "FAIL: $FILE1 does not exist" >&2; exit 1; }
# Assertion #2
test -f "$FILE2" || { echo "FAIL: $FILE2 does not exist" >&2; exit 1; }

# Assertion #3
grep -q 'json' "$FILE1" || { echo "FAIL: effort test does not cover --json flag" >&2; exit 1; }
# Assertion #4
grep -q 'json' "$FILE2" || { echo "FAIL: compression test does not cover --json flag" >&2; exit 1; }
# Assertion #5
grep -q 'all' "$FILE2" || { echo "FAIL: compression test does not cover --all flag" >&2; exit 1; }

# Assertion #6
pnpm vitest run src/commands/effort.test.ts src/commands/compression.test.ts --reporter=verbose 2>&1 || { echo "FAIL: CLI command tests failed" >&2; exit 1; }

echo "PASS: T019 — CLI command tests pass"

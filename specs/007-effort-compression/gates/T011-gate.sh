#!/usr/bin/env bash
# Gate: T011 — Create commit clustering tests
# Contract: tests must exist and pass
set -euo pipefail

FILE="src/engine/commit-cluster.test.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'clusterCommits' "$FILE" || { echo "FAIL: test file does not reference clusterCommits" >&2; exit 1; }

# Assertion #3
pnpm vitest run src/engine/commit-cluster.test.ts --reporter=verbose 2>&1 || { echo "FAIL: commit-cluster tests failed" >&2; exit 1; }

echo "PASS: T011 — commit clustering tests pass"

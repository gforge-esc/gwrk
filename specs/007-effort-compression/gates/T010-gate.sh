#!/usr/bin/env bash
# Gate: T010 — Create commit clustering algorithm
# Contract: src/engine/commit-cluster.ts must export clusterCommits()
set -euo pipefail

FILE="src/engine/commit-cluster.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE does not exist" >&2; exit 1; }

# Assertion #2
grep -q 'export.*function clusterCommits' "$FILE" || \
# Assertion #3
grep -q 'export function clusterCommits' "$FILE" || \
  { echo "FAIL: clusterCommits function not exported" >&2; exit 1; }

# Assertion #4
grep -q 'CommitCluster' "$FILE" || { echo "FAIL: CommitCluster return type not referenced" >&2; exit 1; }
# Assertion #5
grep -q 'gapMinutes' "$FILE" || { echo "FAIL: gapMinutes parameter not found" >&2; exit 1; }

echo "PASS: T010 — commit clustering exports clusterCommits with gap parameter"

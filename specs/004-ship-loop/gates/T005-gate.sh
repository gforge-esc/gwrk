#!/usr/bin/env bash
# T005-gate.sh — Dirty-tree guard in wud-branch.sh (FR-002)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: git status --porcelain check exists
if grep -q 'porcelain' scripts/dev/wud-branch.sh; then
  echo "✓ Assertion #1: porcelain check exists"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #1: porcelain check NOT found in wud-branch.sh"
  FAIL=$((FAIL+1))
fi

# Assertion #2: Dirty tree error message exists
if grep -q 'Dirty working tree' scripts/dev/wud-branch.sh; then
  echo "✓ Assertion #2: dirty tree message exists"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #2: dirty tree message NOT found"
  FAIL=$((FAIL+1))
fi

# Assertion #3: Exits non-zero on dirty tree
if grep -q 'exit 1' scripts/dev/wud-branch.sh; then
  echo "✓ Assertion #3: exit 1 on dirty tree"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #3: exit 1 NOT found"
  FAIL=$((FAIL+1))
fi

echo "T005: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

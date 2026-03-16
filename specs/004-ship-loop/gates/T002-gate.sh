#!/usr/bin/env bash
# T002-gate.sh — emit_event() in work-until-done.sh (FR-017)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: emit_event function defined
if grep -q 'emit_event' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #1: emit_event function exists"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #1: emit_event function NOT found"
  FAIL=$((FAIL+1))
fi

# Assertion #2: emit_event called after BRANCH_SETUP
if grep -q 'emit_event.*BRANCH_SETUP\|emit_event.*branch' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #2: emit_event called for BRANCH_SETUP"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #2: emit_event NOT called for BRANCH_SETUP"
  FAIL=$((FAIL+1))
fi

# Assertion #3: emit_event called after IMPLEMENT
if grep -q 'emit_event.*IMPLEMENT\|emit_event.*implement' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #3: emit_event called for IMPLEMENT"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #3: emit_event NOT called for IMPLEMENT"
  FAIL=$((FAIL+1))
fi

echo "T002: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

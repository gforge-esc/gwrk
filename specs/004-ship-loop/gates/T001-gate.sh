#!/usr/bin/env bash
# T001-gate.sh — isPhaseComplete() with cancelled support (FR-014)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: isPhaseComplete function exists in ship.ts
if grep -q 'function isPhaseComplete\|const isPhaseComplete' src/commands/ship.ts; then
  echo "✓ Assertion #1: isPhaseComplete function exists"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #1: isPhaseComplete function NOT found in ship.ts"
  FAIL=$((FAIL+1))
fi

# Assertion #2: Function checks for 'cancelled' status
if grep -q 'cancelled' src/commands/ship.ts; then
  echo "✓ Assertion #2: 'cancelled' status handled"
  PASS=$((PASS+1))
else
  echo "✗ Assertion #2: 'cancelled' status NOT handled in ship.ts"
  FAIL=$((FAIL+1))
fi

echo "T001: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

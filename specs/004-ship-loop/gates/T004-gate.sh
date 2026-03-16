#!/usr/bin/env bash
# T004-gate.sh — Pre-flight gate runner in WUD (FR-003)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: Pre-flight gate logic exists in WUD
if grep -q 'pre-flight\|preflight\|gate.*PASS\|gateScript' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #1: pre-flight gate logic exists"
  ((PASS++))
else
  echo "✗ Assertion #1: pre-flight gate logic NOT found in WUD"
  ((FAIL++))
fi

# Assertion #2: Gate skip message exists
if grep -q 'pre-flight PASS\|gate already satisfied\|skipping' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #2: gate skip message exists"
  ((PASS++))
else
  echo "✗ Assertion #2: gate skip message NOT found"
  ((FAIL++))
fi

echo "T004: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

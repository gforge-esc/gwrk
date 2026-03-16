#!/usr/bin/env bash
# T009-gate.sh — --format json support (FR-015)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: --format option registered in Commander
if grep -q '\-\-format\|format.*json\|addOption.*format' src/commands/ship.ts; then
  echo "✓ Assertion #1: --format option exists"
  ((PASS++))
else
  echo "✗ Assertion #1: --format option NOT found in ship.ts"
  ((FAIL++))
fi

# Assertion #2: JSON output path exists
if grep -q 'JSON.stringify' src/commands/ship.ts; then
  echo "✓ Assertion #2: JSON output path exists"
  ((PASS++))
else
  echo "✗ Assertion #2: JSON output path NOT found"
  ((FAIL++))
fi

echo "T009: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

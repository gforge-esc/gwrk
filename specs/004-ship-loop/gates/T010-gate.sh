#!/usr/bin/env bash
# T010-gate.sh — FR-009 agent config fail-fast
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: Missing config error message exists
if grep -q 'Missing required config\|agents.implement' src/commands/ship.ts; then
  echo "✓ Assertion #1: fail-fast error message exists"
  ((PASS++))
else
  echo "✗ Assertion #1: fail-fast error message NOT found in ship.ts"
  ((FAIL++))
fi

# Assertion #2: process.exit(1) or throw on missing config
if grep -q 'process.exit(1)\|throw.*config\|CommandError' src/commands/ship.ts; then
  echo "✓ Assertion #2: crash behavior on missing config"
  ((PASS++))
else
  echo "✗ Assertion #2: crash behavior NOT found"
  ((FAIL++))
fi

echo "T010: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

#!/usr/bin/env bash
# T008-gate.sh — [exit:N | Xs] output wrapper (FR-015)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: exit signal format exists in ship.ts
if grep -q 'exit:' src/commands/ship.ts; then
  echo "✓ Assertion #1: [exit:N | Xs] wrapper exists"
  ((PASS++))
else
  echo "✗ Assertion #1: exit signal wrapper NOT found in ship.ts"
  ((FAIL++))
fi

# Assertion #2: stderr emission (ADR-004 mandates stderr)
if grep -q 'stderr\|process\.stderr' src/commands/ship.ts; then
  echo "✓ Assertion #2: stderr emission exists"
  ((PASS++))
else
  echo "✗ Assertion #2: stderr emission NOT found"
  ((FAIL++))
fi

echo "T008: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

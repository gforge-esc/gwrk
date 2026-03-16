#!/usr/bin/env bash
# T007-gate.sh — failureContext on CIRCUIT_BREAK (FR-018)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: failureContext referenced in WUD
if grep -q 'failureContext\|failure_context' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #1: failureContext exists in WUD"
  ((PASS++))
else
  echo "✗ Assertion #1: failureContext NOT found in WUD"
  ((FAIL++))
fi

# Assertion #2: openTasks or lastVerdict in failure context
if grep -q 'openTasks\|open_tasks\|lastVerdict\|last_verdict' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #2: failure context has structured fields"
  ((PASS++))
else
  echo "✗ Assertion #2: structured failure fields NOT found"
  ((FAIL++))
fi

echo "T007: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

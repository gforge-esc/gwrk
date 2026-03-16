#!/usr/bin/env bash
# T006-gate.sh — validate-staging.sh called from WUD (FR-016)
set -euo pipefail
PASS=0; FAIL=0

# Assertion #1: validate-staging.sh is called from work-until-done.sh
if grep -q 'validate-staging' scripts/dev/work-until-done.sh; then
  echo "✓ Assertion #1: validate-staging called from WUD"
  ((PASS++))
else
  echo "✗ Assertion #1: validate-staging NOT called from WUD"
  ((FAIL++))
fi

echo "T006: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

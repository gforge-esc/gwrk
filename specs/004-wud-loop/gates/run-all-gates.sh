#!/usr/bin/env bash
# run-all-gates.sh — Sequential gate runner for 004-wud-loop
#
# Runs all T0xx-gate.sh scripts in order. Reports pass/fail summary.
#
# Usage: ./specs/004-wud-loop/gates/run-all-gates.sh
#
# Exit codes:
#   0 - All gates passed
#   1 - One or more gates failed

set -uo pipefail

GATE_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
FAILED_GATES=()

for gate in "$GATE_DIR"/T*-gate.sh; do
  gate_name=$(basename "$gate")
  if bash "$gate" >/dev/null 2>&1; then
    echo "✅ $gate_name"
    PASS=$((PASS + 1))
  else
    echo "❌ $gate_name"
    FAIL=$((FAIL + 1))
    FAILED_GATES+=("$gate_name")
  fi
done

TOTAL=$((PASS + FAIL))
echo ""
echo "───────────────────────────────"
echo "Results: ${PASS}/${TOTAL} passed, ${FAIL} failed"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Failed gates:"
  for g in "${FAILED_GATES[@]}"; do
    echo "  ✗ $g"
  done
  exit 1
fi

exit 0

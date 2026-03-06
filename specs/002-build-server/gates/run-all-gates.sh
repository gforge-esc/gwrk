#!/usr/bin/env bash
# run-all-gates.sh — Runner for all verification gates
set -u

FEATURE_DIR="specs/002-build-server"
GATES_DIR="$FEATURE_DIR/gates"

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_GATES=0

echo "Running verification gates for $FEATURE_DIR..."
echo "------------------------------------------------"

for gate in $(ls $GATES_DIR/T*-gate.sh | sort); do
  TOTAL_GATES=$((TOTAL_GATES + 1))
  gate_name=$(basename "$gate" .sh)
  
  if bash "$gate"; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "GATE FAILED: $gate_name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo "------------------------------------------------"
echo "Verification Summary:"
echo "Total Gates: $TOTAL_GATES"
echo "Passed:      $PASS_COUNT"
echo "Failed:      $FAIL_COUNT"

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "ALL GATES PASSED"
  exit 0
else
  echo "SOME GATES FAILED"
  exit 1
fi

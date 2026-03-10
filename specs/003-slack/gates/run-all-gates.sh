#!/bin/bash
set -o pipefail
GATES_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
FAILED_GATES=()

for gate in "$GATES_DIR"/T*-gate.sh; do
  gate_name=$(basename "$gate" .sh)
  if bash "$gate" > /dev/null 2>&1; then
    echo "✅ $gate_name"
    ((PASS++))
  else
    echo "❌ $gate_name"
    ((FAIL++))
    FAILED_GATES+=("$gate_name")
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: $PASS passed, $FAIL failed ($(($PASS + $FAIL)) total)"
if [ $FAIL -gt 0 ]; then
  echo "Failed: ${FAILED_GATES[*]}"
  exit 1
fi
echo "All gates passed ✅"

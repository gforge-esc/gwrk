#!/bin/bash
# Hard Gate Runner — Sequential execution of all verification gates
set -e

PASSED=0
FAILED=0
TOTAL=0

# Gather all gate scripts
GATES=$(ls $(dirname "$0")/T*-gate.sh | sort)

echo "────────────────────────────────────────"
echo "  GWRK HARD GATE RUNNER"
echo "────────────────────────────────────────"

for gate in $GATES; do
    TOTAL=$((TOTAL + 1))
    GATE_NAME=$(basename "$gate")
    
    echo -n "▸ Running $GATE_NAME... "
    if "$gate" > /dev/null 2>&1; then
        echo "✅ PASS"
        PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL"
        FAILED=$((FAILED + 1))
    fi
done

echo "────────────────────────────────────────"
echo "  RESULTS: $PASSED passed, $FAILED failed / $TOTAL total"
echo "────────────────────────────────────────"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0

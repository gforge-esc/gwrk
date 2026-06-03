#!/bin/bash
# Hard Gate Runner — runs all T*-gate.sh scripts sequentially
set -e

# Pre-flight: TypeScript compilation must pass before individual gates
echo "▸ pnpm build (compile gate)..."
if pnpm build > /dev/null 2>&1; then
    echo "✅ PASS"
else
    echo "❌ FAIL — pnpm build failed. Fix TypeScript errors before shipping." >&2
    exit 1
fi

PASSED=0; FAILED=0; TOTAL=0
GATES=$(ls "$(dirname "$0")"/T*-gate.sh 2>/dev/null | sort)
echo "────────────────────────────────────────"
echo "  GWRK HARD GATE RUNNER"
echo "────────────────────────────────────────"
for gate in $GATES; do
    TOTAL=$((TOTAL + 1))
    echo -n "▸ $(basename "$gate")... "
    if "$gate" > /dev/null 2>&1; then
        echo "✅ PASS"; PASSED=$((PASSED + 1))
    else
        echo "❌ FAIL"; FAILED=$((FAILED + 1))
    fi
done
echo "────────────────────────────────────────"
echo "  $PASSED passed, $FAILED failed / $TOTAL total"
echo "────────────────────────────────────────"
[ $FAILED -eq 0 ]

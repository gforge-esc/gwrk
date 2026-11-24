#!/bin/bash
# Hard Gate Runner — runs all T*-gate.sh scripts sequentially
set -e

# Pre-flight: compilation gate must pass before individual gates
if [ -f "package.json" ]; then
    echo "▸ pnpm build (compile gate)..."
    if pnpm build > /dev/null 2>&1; then
        echo "✅ PASS"
    else
        echo "❌ FAIL — pnpm build failed. Fix TypeScript errors before shipping." >&2
        exit 1
    fi
elif [ -f "Cargo.toml" ]; then
    echo "▸ cargo check (compile gate)..."
    if cargo check > /dev/null 2>&1; then
        echo "✅ PASS"
    else
        echo "❌ FAIL — cargo check failed." >&2
        exit 1
    fi
elif [ -f "go.mod" ]; then
    echo "▸ go build ./... (compile gate)..."
    if go build ./... > /dev/null 2>&1; then
        echo "✅ PASS"
    else
        echo "❌ FAIL — go build failed." >&2
        exit 1
    fi
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
if [ "$TOTAL" -eq 0 ]; then
    echo "❌ FAIL — no T*-gate.sh found next to this runner; refusing to report a pass over zero gates." >&2
    exit 1
fi
[ $FAILED -eq 0 ]

#!/bin/bash
# AUTHORED
set -euo pipefail

# T030: Verify src/utils/gate-runner.ts exists with runGate function
test -f src/utils/gate-runner.ts || { echo "FAIL: src/utils/gate-runner.ts missing" >&2; exit 1; }
grep -q 'runGate' src/utils/gate-runner.ts || { echo "FAIL: runGate function missing" >&2; exit 1; }

# Verify compile
pnpm build > /dev/null 2>&1 || { echo "FAIL: pnpm build failed" >&2; exit 1; }

echo "PASS: T030 — src/utils/gate-runner.ts exists with runGate()"

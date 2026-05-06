#!/bin/bash
# AUTHORED
set -euo pipefail

# T032: Verify ship-orchestrator tests exist and pass
test -f src/engine/ship-orchestrator.test.ts || { echo "FAIL: src/engine/ship-orchestrator.test.ts missing" >&2; exit 1; }
grep -q 'BRANCH_SETUP' src/engine/ship-orchestrator.test.ts || { echo "FAIL: BRANCH_SETUP test missing" >&2; exit 1; }
grep -q 'CIRCUIT_BREAK' src/engine/ship-orchestrator.test.ts || { echo "FAIL: CIRCUIT_BREAK test missing" >&2; exit 1; }

# Run the tests
pnpm vitest run src/engine/ship-orchestrator.test.ts > /dev/null 2>&1 || { echo "FAIL: ship-orchestrator tests failed" >&2; exit 1; }

echo "PASS: T032 — ship-orchestrator tests exist and pass"

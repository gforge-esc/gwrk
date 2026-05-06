#!/bin/bash
# AUTHORED
set -euo pipefail

# T031: Verify src/engine/ship-orchestrator.ts exists with state machine
test -f src/engine/ship-orchestrator.ts || { echo "FAIL: src/engine/ship-orchestrator.ts missing" >&2; exit 1; }
grep -q 'ShipOrchestrator' src/engine/ship-orchestrator.ts || { echo "FAIL: ShipOrchestrator class missing" >&2; exit 1; }
grep -q 'BRANCH_SETUP' src/engine/ship-orchestrator.ts || { echo "FAIL: BRANCH_SETUP stage missing" >&2; exit 1; }
grep -q 'CIRCUIT_BREAK' src/engine/ship-orchestrator.ts || { echo "FAIL: CIRCUIT_BREAK stage missing" >&2; exit 1; }
grep -q 'dispatchToAgent' src/engine/ship-orchestrator.ts || { echo "FAIL: dispatchToAgent consumption missing" >&2; exit 1; }
grep -q 'failureContext' src/engine/ship-orchestrator.ts || { echo "FAIL: failureContext missing" >&2; exit 1; }

# Verify compile
pnpm build > /dev/null 2>&1 || { echo "FAIL: pnpm build failed" >&2; exit 1; }

echo "PASS: T031 — src/engine/ship-orchestrator.ts exists with full state machine"

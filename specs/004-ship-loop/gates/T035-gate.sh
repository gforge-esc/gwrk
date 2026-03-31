#!/bin/bash
# AUTHORED
set -euo pipefail

# T035: Full Phase 5 verification — all tests pass, build compiles, gates pass

# Compile gate
pnpm build > /dev/null 2>&1 || { echo "FAIL: pnpm build failed" >&2; exit 1; }

# Ship orchestrator tests
pnpm vitest run src/engine/ship-orchestrator.test.ts > /dev/null 2>&1 || { echo "FAIL: ship-orchestrator tests failed" >&2; exit 1; }

# Gate runner tests (if they exist)
if [ -f src/utils/gate-runner.test.ts ]; then
  pnpm vitest run src/utils/gate-runner.test.ts > /dev/null 2>&1 || { echo "FAIL: gate-runner tests failed" >&2; exit 1; }
fi

# Verify ShipOrchestrator is wired in
grep -q 'ShipOrchestrator' src/commands/ship.ts || { echo "FAIL: ShipOrchestrator not wired" >&2; exit 1; }

echo "PASS: T035 — Phase 5 verification complete"

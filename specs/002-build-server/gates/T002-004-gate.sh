#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-004 — Server listens for ShipOrchestrator events
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-004 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/ship-bridge.test.ts --grep "FR-005" --reporter=verbose

echo "PASS: T002-004 — vitest verification complete"

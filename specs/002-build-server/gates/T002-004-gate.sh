#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-004 — Server listens for ShipOrchestrator events
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/ship-bridge.test.ts -t "FR-005" --reporter=verbose \
  || { echo "FAIL: T002-004 — vitest failed for src/server/ship-bridge.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/ship-bridge.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002-004 — lint errors in src/server/ship-bridge.ts" >&2; exit 1; }

echo "PASS: T002-004 — tests pass + lint clean"

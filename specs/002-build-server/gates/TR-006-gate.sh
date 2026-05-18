#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-006 — ShipOrchestrator events mapped to Slack
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/ship-bridge.test.ts -t "FR-005|FR-006|US-003" --reporter=verbose \
  || { echo "FAIL: TR-006 — vitest failed for src/server/ship-bridge.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/ship-bridge.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-006 — lint errors in src/server/ship-bridge.ts" >&2; exit 1; }

echo "PASS: TR-006 — tests pass + lint clean"

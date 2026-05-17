#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-004 — Sleep detection via heartbeat drift
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/lifecycle.test.ts --grep "FR-008|US-005" --reporter=verbose \
  || { echo "FAIL: TR-004 — vitest failed for src/server/lifecycle.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/lifecycle.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-004 — lint errors in src/server/lifecycle.ts" >&2; exit 1; }

echo "PASS: TR-004 — tests pass + lint clean"

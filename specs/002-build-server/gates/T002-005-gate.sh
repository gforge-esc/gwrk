#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-005 — Messages must have exactly one primary CTA
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/ship-bridge.test.ts -t "FR-006|US-003" --reporter=verbose \
  || { echo "FAIL: T002-005 — vitest failed for src/server/ship-bridge.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/ship-bridge.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002-005 — lint errors in src/server/ship-bridge.ts" >&2; exit 1; }

echo "PASS: T002-005 — tests pass + lint clean"

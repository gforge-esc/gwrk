#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-005 — Network state monitoring
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/network.test.ts -t "FR-010|US-006" --reporter=verbose \
  || { echo "FAIL: TR-005 — vitest failed for src/server/network.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/network.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-005 — lint errors in src/server/network.ts" >&2; exit 1; }

echo "PASS: TR-005 — tests pass + lint clean"

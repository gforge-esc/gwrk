#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T062 — setup.json state persistence
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/setup-state.test.ts -t "US-021" --reporter=verbose \
  || { echo "FAIL: T062 — vitest failed for src/utils/setup-state.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/setup-state.ts --no-errors-on-unmatched \
  || { echo "FAIL: T062 — lint errors in src/utils/setup-state.ts" >&2; exit 1; }

echo "PASS: T062 — tests pass + lint clean"

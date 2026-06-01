#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Status Transition History
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/state.test.ts -t "US-007" --reporter=verbose \
  || { echo "FAIL: T007 — vitest failed for src/utils/state.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/state.ts --no-errors-on-unmatched \
  || { echo "FAIL: T007 — lint errors in src/utils/state.ts" >&2; exit 1; }

echo "PASS: T007 — tests pass + lint clean"

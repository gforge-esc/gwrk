#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T013 — Ship (Full Lifecycle)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/ship.test.ts -t "US-013" --reporter=verbose \
  || { echo "FAIL: T013 — vitest failed for src/commands/ship.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/ship.ts --no-errors-on-unmatched \
  || { echo "FAIL: T013 — lint errors in src/commands/ship.ts" >&2; exit 1; }

echo "PASS: T013 — tests pass + lint clean"

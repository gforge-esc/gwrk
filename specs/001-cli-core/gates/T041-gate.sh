#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T041 — Workstation setup wizard (4 steps)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/setup.test.ts -t "US-021" --reporter=verbose \
  || { echo "FAIL: T041 — vitest failed for src/commands/setup.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/setup.ts --no-errors-on-unmatched \
  || { echo "FAIL: T041 — lint errors in src/commands/setup.ts" >&2; exit 1; }

echo "PASS: T041 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Effort Estimation
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/effort.test.ts --reporter=verbose \
  || { echo "FAIL: T010 — vitest failed for src/commands/effort.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/effort.ts --no-errors-on-unmatched \
  || { echo "FAIL: T010 — lint errors in src/commands/effort.ts" >&2; exit 1; }

echo "PASS: T010 — tests pass + lint clean"

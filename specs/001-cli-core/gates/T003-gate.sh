#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Agent Planning
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/plan.test.ts -t "US-003" --reporter=verbose \
  || { echo "FAIL: T003 — vitest failed for src/commands/plan.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/plan.ts --no-errors-on-unmatched \
  || { echo "FAIL: T003 — lint errors in src/commands/plan.ts" >&2; exit 1; }

echo "PASS: T003 — tests pass + lint clean"

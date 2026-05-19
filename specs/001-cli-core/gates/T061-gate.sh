#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T061 — Workstation setup wizard (4 steps)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/setup.test.ts -t "US-021" --reporter=verbose \
  || { echo "FAIL: T061 — vitest failed for src/commands/setup.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/setup.ts --no-errors-on-unmatched \
  || { echo "FAIL: T061 — lint errors in src/commands/setup.ts" >&2; exit 1; }

echo "PASS: T061 — tests pass + lint clean"

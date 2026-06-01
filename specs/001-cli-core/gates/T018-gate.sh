#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T018 — CLI Surface Verification
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/cli.test.ts -t "US-018" --reporter=verbose \
  || { echo "FAIL: T018 — vitest failed for src/cli.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/cli.ts --no-errors-on-unmatched \
  || { echo "FAIL: T018 — lint errors in src/cli.ts" >&2; exit 1; }

echo "PASS: T018 — tests pass + lint clean"

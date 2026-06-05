#!/bin/bash
set -euo pipefail
# Gate: T041 — Extend GwrkConfigSchema with project profile fields
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/config.test.ts -t "Config Schema Extension" --reporter=verbose \
  || { echo "FAIL: T041 — vitest failed for src/utils/config.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/config.ts --no-errors-on-unmatched \
  || { echo "FAIL: T041 — lint errors in src/utils/config.ts" >&2; exit 1; }

echo "PASS: T041 — tests pass + lint clean"

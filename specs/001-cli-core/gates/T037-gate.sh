#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T037 — Execution Manifest generation
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/manifest.test.ts -t "US-019|FR-019" --reporter=verbose \
  || { echo "FAIL: T037 — vitest failed for src/utils/manifest.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/manifest.ts --no-errors-on-unmatched \
  || { echo "FAIL: T037 — lint errors in src/utils/manifest.ts" >&2; exit 1; }

echo "PASS: T037 — tests pass + lint clean"

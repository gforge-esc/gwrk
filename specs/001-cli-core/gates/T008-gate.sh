#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Configuration Validation
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/config.test.ts --reporter=verbose \
  || { echo "FAIL: T008 — vitest failed for src/utils/config.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/config.ts --no-errors-on-unmatched \
  || { echo "FAIL: T008 — lint errors in src/utils/config.ts" >&2; exit 1; }

echo "PASS: T008 — tests pass + lint clean"

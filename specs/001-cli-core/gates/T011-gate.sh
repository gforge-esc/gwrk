#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T011 — Define Pillar (DUS loop)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/define.test.ts --reporter=verbose \
  || { echo "FAIL: T011 — vitest failed for src/commands/define.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/define.ts --no-errors-on-unmatched \
  || { echo "FAIL: T011 — lint errors in src/commands/define.ts" >&2; exit 1; }

echo "PASS: T011 — tests pass + lint clean"

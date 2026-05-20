#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T012 — Ship Pillar (Agent implementation)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/implement.test.ts -t "US-012" --reporter=verbose \
  || { echo "FAIL: T012 — vitest failed for src/commands/implement.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/implement.ts --no-errors-on-unmatched \
  || { echo "FAIL: T012 — lint errors in src/commands/implement.ts" >&2; exit 1; }

echo "PASS: T012 — tests pass + lint clean"

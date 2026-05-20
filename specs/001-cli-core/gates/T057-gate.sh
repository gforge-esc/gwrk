#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T057 — Quiet output parity (specify)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/specify.test.ts -t "US-026" --reporter=verbose \
  || { echo "FAIL: T057 — vitest failed for src/commands/specify.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/specify.ts --no-errors-on-unmatched \
  || { echo "FAIL: T057 — lint errors in src/commands/specify.ts" >&2; exit 1; }

echo "PASS: T057 — tests pass + lint clean"

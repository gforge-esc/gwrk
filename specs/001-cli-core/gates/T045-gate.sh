#!/bin/bash
set -euo pipefail
# Gate: T045 — Implement gwrk init interactive wizard skeleton and profile confirmation
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/init.test.ts -t "interactive profile wizard" --reporter=verbose \
  || { echo "FAIL: T045 — vitest failed for src/commands/init.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/init.ts --no-errors-on-unmatched \
  || { echo "FAIL: T045 — lint errors in src/commands/init.ts" >&2; exit 1; }

echo "PASS: T045 — tests pass + lint clean"

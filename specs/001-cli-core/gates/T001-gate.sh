#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Project Initialization
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/init.test.ts -t "US-001|FR-001" --reporter=verbose \
  || { echo "FAIL: T001 — vitest failed for src/commands/init.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/init.ts --no-errors-on-unmatched \
  || { echo "FAIL: T001 — lint errors in src/commands/init.ts" >&2; exit 1; }

echo "PASS: T001 — tests pass + lint clean"

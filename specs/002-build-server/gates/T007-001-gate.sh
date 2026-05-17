#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007-001 — Agent dispatch recorded in SQLite
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/db/runs.test.ts --grep "FR-011" --reporter=verbose \
  || { echo "FAIL: T007-001 — vitest failed for src/db/runs.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/db/runs.ts --no-errors-on-unmatched \
  || { echo "FAIL: T007-001 — lint errors in src/db/runs.ts" >&2; exit 1; }

echo "PASS: T007-001 — tests pass + lint clean"

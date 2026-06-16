#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Task Decomposition
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/tasks-generate.test.ts --reporter=verbose \
  || { echo "FAIL: T004 — vitest failed for src/commands/tasks-generate.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/tasks-generate.ts --no-errors-on-unmatched \
  || { echo "FAIL: T004 — lint errors in src/commands/tasks-generate.ts" >&2; exit 1; }

echo "PASS: T004 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Agent Specification
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/specify.test.ts -t "US-002" --reporter=verbose \
  || { echo "FAIL: T002 — vitest failed for src/commands/specify.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/specify.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002 — lint errors in src/commands/specify.ts" >&2; exit 1; }

echo "PASS: T002 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-010 — Home tab shows plan DAG status
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/slack-home.test.ts -t "US-005" --reporter=verbose \
  || { echo "FAIL: T002-010 — vitest failed for src/server/slack-home.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/slack-home.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002-010 — lint errors in src/server/slack-home.ts" >&2; exit 1; }

echo "PASS: T002-010 — tests pass + lint clean"

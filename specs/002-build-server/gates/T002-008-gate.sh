#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-008 — merge_pr action merged PR via gh CLI
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/slack-actions.test.ts -t "FR-007" --reporter=verbose \
  || { echo "FAIL: T002-008 — vitest failed for src/server/slack-actions.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/slack-actions.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002-008 — lint errors in src/server/slack-actions.ts" >&2; exit 1; }

echo "PASS: T002-008 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-013 — Approve Spec button advances pipeline
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/slack-actions.test.ts --grep "US-004|US-004" --reporter=verbose \
  || { echo "FAIL: T002-013 — vitest failed for src/server/slack-actions.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/slack-actions.ts --no-errors-on-unmatched \
  || { echo "FAIL: T002-013 — lint errors in src/server/slack-actions.ts" >&2; exit 1; }

echo "PASS: T002-013 — tests pass + lint clean"

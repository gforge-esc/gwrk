#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-007 — Button taps trigger pipeline actions
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/server/slack-actions.test.ts --grep "FR-007|US-004" --reporter=verbose \
  || { echo "FAIL: TR-007 — vitest failed for src/server/slack-actions.test.ts" >&2; exit 1; }

pnpm vitest run src/db/runs.test.ts --grep "FR-011|US-007" --reporter=verbose \
  || { echo "FAIL: TR-007 — vitest failed for src/db/runs.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/server/slack-actions.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-007 — lint errors in src/server/slack-actions.ts" >&2; exit 1; }

pnpm biome check src/db/runs.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-007 — lint errors in src/db/runs.ts" >&2; exit 1; }

echo "PASS: TR-007 — tests pass + lint clean"

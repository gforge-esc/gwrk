#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T024 — history.jsonl deprecation
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/history.test.ts -t "FR-021" --reporter=verbose \
  || { echo "FAIL: T024 — vitest failed for src/utils/history.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/history.ts --no-errors-on-unmatched \
  || { echo "FAIL: T024 — lint errors in src/utils/history.ts" >&2; exit 1; }

echo "PASS: T024 — tests pass + lint clean"

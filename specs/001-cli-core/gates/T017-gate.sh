#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T017 — Pulse Dashboard
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/pulse.test.ts --reporter=verbose \
  || { echo "FAIL: T017 — vitest failed for src/commands/pulse.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/pulse.ts --no-errors-on-unmatched \
  || { echo "FAIL: T017 — lint errors in src/commands/pulse.ts" >&2; exit 1; }

echo "PASS: T017 — tests pass + lint clean"

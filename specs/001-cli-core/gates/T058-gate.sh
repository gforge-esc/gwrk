#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T058 — Quiet output parity (plan)
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/define-plan.test.ts --reporter=verbose \
  || { echo "FAIL: T058 — vitest failed for src/commands/define-plan.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/define-plan.ts --no-errors-on-unmatched \
  || { echo "FAIL: T058 — lint errors in src/commands/define-plan.ts" >&2; exit 1; }

echo "PASS: T058 — tests pass + lint clean"

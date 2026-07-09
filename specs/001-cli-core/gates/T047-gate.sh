#!/bin/bash
set -euo pipefail
# Gate: T047 — Implement --non-interactive flag, project registration, and final scaffolding
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/init.test.ts -t "non-interactive|idempotent|registration" --reporter=verbose \
  || { echo "FAIL: T047 — vitest failed for src/commands/init.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/init.ts --no-errors-on-unmatched \
  || { echo "FAIL: T047 — lint errors in src/commands/init.ts" >&2; exit 1; }

echo "PASS: T047 — tests pass + lint clean"

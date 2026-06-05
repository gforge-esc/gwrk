#!/bin/bash
set -euo pipefail
# Gate: T044 — Refactor setup-slack.ts for internal callability
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/setup-slack.test.ts --reporter=verbose \
  || { echo "FAIL: T044 — vitest failed for src/commands/setup-slack.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/setup-slack.ts --no-errors-on-unmatched \
  || { echo "FAIL: T044 — lint errors in src/commands/setup-slack.ts" >&2; exit 1; }

echo "PASS: T044 — tests pass + lint clean"

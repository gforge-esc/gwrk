#!/bin/bash
set -euo pipefail
# Gate: T046 — Integrate agent CLI detection and workstation setup into init flow
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/init.test.ts -t "agent CLI detection|workstation provisioning" --reporter=verbose \
  || { echo "FAIL: T046 — vitest failed for src/commands/init.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/init.ts --no-errors-on-unmatched \
  || { echo "FAIL: T046 — lint errors in src/commands/init.ts" >&2; exit 1; }

echo "PASS: T046 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-018 — dispatchToAgent injects extension context
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/utils/agent.test.ts -t "FR-L3-006" --reporter=verbose \
  || { echo "FAIL: TR-018 — vitest failed for src/utils/agent.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/utils/agent.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-018 — lint errors in src/utils/agent.ts" >&2; exit 1; }

echo "PASS: TR-018 — tests pass + lint clean"

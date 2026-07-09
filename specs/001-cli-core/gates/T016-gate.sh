#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T016 — Compression Tracking
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/compression.test.ts --reporter=verbose \
  || { echo "FAIL: T016 — vitest failed for src/commands/compression.test.ts" >&2; exit 1; }

pnpm vitest run src/utils/agent.test.ts --reporter=verbose \
  || { echo "FAIL: T016 — vitest failed for src/utils/agent.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/compression.ts --no-errors-on-unmatched \
  || { echo "FAIL: T016 — lint errors in src/commands/compression.ts" >&2; exit 1; }

pnpm biome check src/utils/agent.ts --no-errors-on-unmatched \
  || { echo "FAIL: T016 — lint errors in src/utils/agent.ts" >&2; exit 1; }

echo "PASS: T016 — tests pass + lint clean"

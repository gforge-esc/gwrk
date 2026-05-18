#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-001 — gwrk server start/stop PID management
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/server.test.ts -t "FR-001|FR-003|US-001" --reporter=verbose \
  || { echo "FAIL: TR-001 — vitest failed for src/commands/server.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/commands/server.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-001 — lint errors in src/commands/server.ts" >&2; exit 1; }

echo "PASS: TR-001 — tests pass + lint clean"

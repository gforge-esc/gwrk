#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Modify ship-orchestrator.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/engine/ship-orchestrator.ts || { echo "FAIL: T007 — file not found: src/engine/ship-orchestrator.ts" >&2; exit 1; }

pnpm vitest run src/engine/ship-orchestrator.test.ts --reporter=verbose \
  || { echo "FAIL: T007 — vitest failed for src/engine/ship-orchestrator.test.ts" >&2; exit 1; }

echo "PASS: T007 — Modify ship-orchestrator.ts"

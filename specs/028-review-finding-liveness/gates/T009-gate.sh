#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T009 — Update ship-orchestrator.review-finding-liveness.test.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/engine/ship-orchestrator.review-finding-liveness.test.ts || { echo "FAIL: T009 — file not found: src/engine/ship-orchestrator.review-finding-liveness.test.ts" >&2; exit 1; }

pnpm vitest run src/engine/ship-orchestrator.review-finding-liveness.test.ts --reporter=verbose \
  || { echo "FAIL: T009 — vitest failed for src/engine/ship-orchestrator.review-finding-liveness.test.ts" >&2; exit 1; }

echo "PASS: T009 — Update ship-orchestrator.review-finding-liveness.test.ts"

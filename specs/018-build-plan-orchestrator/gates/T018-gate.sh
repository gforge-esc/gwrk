#!/bin/bash
set -euo pipefail
# Gate: T018 — Implement test strategy for Phase 3

pnpm vitest run src/engine/ship-orchestrator.test.ts src/engine/define-orchestrator.test.ts src/engine/plan-store.test.ts

echo "PASS: T018 — Phase 3 tests pass"

#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement test strategy for Phase 1

pnpm vitest run src/db/plan.test.ts src/engine/plan-store.test.ts src/engine/readiness-scanner.test.ts

echo "PASS: T008 — Phase 1 tests pass"

#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement test strategy for Phase 2

pnpm vitest run src/engine/plan-solver.test.ts

echo "PASS: T012 — Phase 2 tests pass"

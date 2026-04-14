#!/bin/bash
set -euo pipefail
# Gate: T027 — Implement test strategy for Phase 5

pnpm vitest run src/engine/plan-store.test.ts

echo "PASS: T027 — Phase 5 tests pass"

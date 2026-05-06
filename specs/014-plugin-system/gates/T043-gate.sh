#!/bin/bash
# AUTHORED
set -euo pipefail

# Aggregate gate for Phase 7 routing & intelligence
pnpm vitest run src/engine/router.test.ts --reporter=verbose \
  || { echo "FAIL: T043 — vitest failed for Phase 7 tests" >&2; exit 1; }

echo "PASS: T043 — Implement test strategy for Phase 7"

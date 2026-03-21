#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T005: Phase 1 test strategy verification

pnpm vitest run src/server/sandbox.test.ts --reporter=verbose \
  || { echo "FAIL: T005 — vitest failed for src/server/sandbox.test.ts (Phase 1 tests)" >&2; exit 1; }

echo "PASS: T005 — Implement test strategy for Phase 1"

#!/bin/bash
# T012: Implement test strategy for Phase 2
set -e
npx vitest run src/engine/plan-solver.test.ts
echo "T012: All Phase 2 tests passing."
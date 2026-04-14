#!/bin/bash
# T009: Implement src/engine/plan-solver.ts
set -e
test -f "src/engine/plan-solver.ts"
npx vitest run src/engine/plan-solver.test.ts
echo "T009: Plan solver engine implemented."
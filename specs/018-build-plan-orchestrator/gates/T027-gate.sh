#!/bin/bash
# T027: Implement test strategy for Phase 5
set -e
npx vitest run src/engine/plan-store.proposals.test.ts
if [ -f src/server/plan-viz.test.ts ]; then npx vitest run src/server/plan-viz.test.ts; fi
echo "T027: All Phase 5 tests passing."
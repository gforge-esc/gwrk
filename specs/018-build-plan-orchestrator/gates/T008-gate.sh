#!/bin/bash
# T008: Implement test strategy for Phase 1
set -e
npx vitest run src/db/plan.test.ts \
               src/engine/plan-store.test.ts \
               src/engine/readiness-scanner.test.ts \
               src/commands/plan-top-level.test.ts \
               src/utils/parser-plan.test.ts
echo "T008: All Phase 1 tests passing."
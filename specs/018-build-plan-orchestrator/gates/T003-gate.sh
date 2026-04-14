#!/bin/bash
# T003: Implement src/engine/plan-store.ts
set -e
test -f "src/engine/plan-store.ts"
npx vitest run src/engine/plan-store.test.ts
echo "T003: Plan store engine implemented and verified."
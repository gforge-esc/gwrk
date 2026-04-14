#!/bin/bash
# T002: Implement src/db/plan.ts
set -e
test -f "src/db/plan.ts"
npx vitest run src/db/plan.test.ts
echo "T002: DB access logic implemented and verified."
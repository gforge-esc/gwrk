#!/bin/bash
# T006: Implement src/utils/parser-plan.ts
set -e
test -f "src/utils/parser-plan.ts"
npx vitest run src/utils/parser-plan.test.ts
echo "T006: Plan parser implemented and verified."
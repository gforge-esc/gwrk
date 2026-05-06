#!/bin/bash
# T005: Implement src/commands/plan.ts
set -e
test -f "src/commands/plan.ts"
npx vitest run src/commands/plan-top-level.test.ts
echo "T005: CLI plan command foundation implemented."
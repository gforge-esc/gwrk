#!/bin/bash
# T004: Implement src/engine/readiness-scanner.ts
set -e
test -f "src/engine/readiness-scanner.ts"
npx vitest run src/engine/readiness-scanner.test.ts
echo "T004: Readiness scanner implemented and verified."
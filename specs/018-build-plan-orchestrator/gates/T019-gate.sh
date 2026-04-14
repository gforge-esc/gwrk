#!/bin/bash
# T019: Implement src/engine/drift-detector.ts
set -e
test -f "src/engine/drift-detector.ts"
npx vitest run src/engine/drift-detector.test.ts
echo "T019: Drift detector implemented."
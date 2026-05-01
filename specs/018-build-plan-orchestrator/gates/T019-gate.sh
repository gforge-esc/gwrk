#!/bin/bash
# T019: Implement src/engine/drift-detector.ts
# Gate: Tests must pass AND implementation must not throw "not implemented"
set -e
test -f "src/engine/drift-detector.ts"
# Verify the stub is gone
if grep -q "Method not implemented" src/engine/drift-detector.ts; then
  echo "FAIL: drift-detector.ts still contains stub"
  exit 1
fi
npx vitest run src/engine/drift-detector.test.ts
echo "T019: Drift detector implemented and tested."
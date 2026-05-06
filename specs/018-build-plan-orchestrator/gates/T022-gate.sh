#!/bin/bash
# T022: Implement test strategy for Phase 4
set -e
npx vitest run src/engine/drift-detector.test.ts
if [ -f src/engine/plan-renderer.test.ts ]; then npx vitest run src/engine/plan-renderer.test.ts; fi
echo "T022: Phase 4 tests verified."
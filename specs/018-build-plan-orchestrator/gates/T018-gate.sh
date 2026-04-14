#!/bin/bash
# T018: Implement test strategy for Phase 3
set -e
npx vitest run src/engine/ship-orchestrator.plan-event.test.ts \
               src/engine/define-orchestrator.test.ts
echo "T018: All Phase 3 tests passing."
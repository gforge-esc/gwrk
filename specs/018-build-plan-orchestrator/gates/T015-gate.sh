#!/bin/bash
# T015: Implement src/engine/define-orchestrator.ts (hooks)
set -e
grep -q "plan:define:complete" src/engine/define-orchestrator.ts
npx vitest run src/engine/define-orchestrator.test.ts
echo "T015: Define orchestrator emits plan events."
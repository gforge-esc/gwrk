#!/bin/bash
# T014: Implement src/engine/ship-orchestrator.ts (hooks)
set -e
grep -q "plan:ship:complete" src/engine/ship-orchestrator.ts
npx vitest run src/engine/ship-orchestrator.plan-event.test.ts
echo "T014: Ship orchestrator emits plan events."
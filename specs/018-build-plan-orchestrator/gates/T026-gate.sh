#!/bin/bash
# T026: Implement src/engine/plan-store.ts (proposals)
set -e
grep -q "Proposal" src/engine/plan-store.ts
npx vitest run src/engine/plan-store.proposals.test.ts
echo "T026: Proposal management implemented."
#!/bin/bash
set -euo pipefail
# Gate: T016 — Implement src/engine/plan-store.ts (mutation)

grep -q "addPhase" src/engine/plan-store.ts
grep -q "removePhase" src/engine/plan-store.ts

echo "PASS: T016 — Mutation methods added to PlanStore"

#!/bin/bash
set -euo pipefail
# Gate: T026 — Implement src/engine/plan-store.ts (proposals)

grep -q "plan_proposals" src/engine/plan-store.ts

echo "PASS: T026 — Proposal management added to PlanStore"

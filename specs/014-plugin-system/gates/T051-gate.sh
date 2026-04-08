#!/bin/bash
# AUTHORED
set -euo pipefail

# T051: ShipOrchestrator uses ReviewPlugin, not hardcoded paths
! grep -q '".agents/workflows/gwrk-review-code.md"' src/engine/ship-orchestrator.ts || { echo "FAIL: stageCodeReview still hardcodes workflow path"; exit 1; }
! grep -q '".agents/workflows/gwrk-review-uat.md"' src/engine/ship-orchestrator.ts || { echo "FAIL: stageUatReview still hardcodes workflow path"; exit 1; }

# Must use resolveReviewPlugin
grep -q "resolveReviewPlugin" src/engine/ship-orchestrator.ts

echo "PASS: T051 — ShipOrchestrator plugin dispatch"

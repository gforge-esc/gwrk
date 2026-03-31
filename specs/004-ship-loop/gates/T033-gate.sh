#!/bin/bash
# AUTHORED
set -euo pipefail

# T033: Verify orchestrator contract exists
test -f specs/004-ship-loop/contracts/orchestrator.md || { echo "FAIL: contracts/orchestrator.md missing" >&2; exit 1; }
grep -q 'ShipOrchestrator' specs/004-ship-loop/contracts/orchestrator.md || { echo "FAIL: ShipOrchestrator not documented" >&2; exit 1; }
grep -q 'ShipState' specs/004-ship-loop/contracts/orchestrator.md || { echo "FAIL: ShipState not documented" >&2; exit 1; }

echo "PASS: T033 — contracts/orchestrator.md exists with ShipOrchestrator contract"

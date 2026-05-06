#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Implement test strategy for Phase 1

# Assertion 1: Verify all other Phase 1 gates pass
bash specs/004-ship-loop/gates/T001-gate.sh > /dev/null
bash specs/004-ship-loop/gates/T002-gate.sh > /dev/null
bash specs/004-ship-loop/gates/T003-gate.sh > /dev/null
bash specs/004-ship-loop/gates/T004-gate.sh > /dev/null
bash specs/004-ship-loop/gates/T005-gate.sh > /dev/null

echo "PASS: T006 — Phase 1 test strategy verified (all gates pass)"

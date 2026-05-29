#!/bin/bash
# AUTHORED
set -euo pipefail

# T049: Implement test strategy for Phase 9
# This task is done when all TR gates for Phase 9 (Review Plugin Layer) pass.

GATES_DIR="specs/014-plugin-system/gates"

bash "$GATES_DIR/TR-013-gate.sh" || { echo "FAIL: T049 — TR-013-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-014-gate.sh" || { echo "FAIL: T049 — TR-014-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-015-gate.sh" || { echo "FAIL: T049 — TR-015-gate.sh failed" >&2; exit 1; }

echo "PASS: T049 — Review Plugin Layer test strategy implemented and passing"
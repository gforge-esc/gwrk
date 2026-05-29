#!/bin/bash
# AUTHORED
set -euo pipefail

# T049: Implement test strategy for Phase 9
# This task is done when all TR gates for Phase 9 pass.

GATES_DIR="specs/014-plugin-system/gates"

bash "$GATES_DIR/TR-P9-001-gate.sh" || { echo "FAIL: T049 — TR-P9-001-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-P9-002-gate.sh" || { echo "FAIL: T049 — TR-P9-002-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-P9-003-gate.sh" || { echo "FAIL: T049 — TR-P9-003-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-P9-004-gate.sh" || { echo "FAIL: T049 — TR-P9-004-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-P9-005-gate.sh" || { echo "FAIL: T049 — TR-P9-005-gate.sh failed" >&2; exit 1; }
bash "$GATES_DIR/TR-P9-006-gate.sh" || { echo "FAIL: T049 — TR-P9-006-gate.sh failed" >&2; exit 1; }

echo "PASS: T049 — Phase 9 test strategy implemented and passing"
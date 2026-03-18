#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T026 — Implement specs/004-ship-loop/contracts/dispatch.md: NEW: TaskDispatch → TaskResult

FILE="specs/004-ship-loop/contracts/dispatch.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Contract mentions TaskDispatch and TaskResult
grep -q "TaskDispatch" "$FILE"
grep -q "TaskResult" "$FILE"

# Assertion 3: Contract mentions error types and exit code mapping
grep -q "errorTypes" "$FILE"
grep -q "exit code mapping" "$FILE"

echo "PASS: T026 — specs/004-ship-loop/contracts/dispatch.md implementation verified"

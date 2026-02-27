#!/usr/bin/env bash
# Gate: T014 — Create shared server types
# Contract: src/server/types.ts must export DispatchRecord, DispatchAttempt, DispatchStatus, SystemStatus, SandboxInfo
set -euo pipefail

FILE="src/server/types.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'DispatchRecord' "$FILE" || { echo "FAIL: DispatchRecord type not found"; exit 1; }
# Assertion #3
grep -q 'DispatchAttempt' "$FILE" || { echo "FAIL: DispatchAttempt type not found"; exit 1; }
# Assertion #4
grep -q 'DispatchStatus' "$FILE" || { echo "FAIL: DispatchStatus type not found"; exit 1; }
# Assertion #5
grep -q 'SystemStatus' "$FILE" || { echo "FAIL: SystemStatus type not found"; exit 1; }
# Assertion #6
grep -q 'SandboxInfo' "$FILE" || { echo "FAIL: SandboxInfo type not found"; exit 1; }

# Verify Zod schemas exist
# Assertion #7
grep -q 'z\.object\|z\.enum' "$FILE" || { echo "FAIL: No Zod schemas found"; exit 1; }

echo "PASS: T014"

#!/usr/bin/env bash
# Gate: T003 — Create PID file manager
# Contract: src/server/pid.ts must export writePid, readPid, removePid
set -euo pipefail

FILE="src/server/pid.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'export.*function writePid' "$FILE" || grep -q 'export function writePid' "$FILE" || { echo "FAIL: writePid not exported"; exit 1; }
# Assertion #3
grep -q 'export.*function readPid' "$FILE" || grep -q 'export function readPid' "$FILE" || { echo "FAIL: readPid not exported"; exit 1; }
# Assertion #4
grep -q 'export.*function removePid' "$FILE" || grep -q 'export function removePid' "$FILE" || { echo "FAIL: removePid not exported"; exit 1; }

# Verify readPid returns number | null
# Assertion #5
grep -q 'number | null\|number|null' "$FILE" || { echo "FAIL: readPid must return number | null"; exit 1; }

echo "PASS: T003"

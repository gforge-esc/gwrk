#!/usr/bin/env bash
# Gate: T023 — Create DispatchQueue class
# Contract: src/server/dispatch.ts must export DispatchQueue with enqueue, processNext, handleCompletion, getQueue, getDispatch
set -euo pipefail

FILE="src/server/dispatch.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'class DispatchQueue\|export class DispatchQueue' "$FILE" || { echo "FAIL: DispatchQueue class not found"; exit 1; }
# Assertion #3
grep -q 'enqueue' "$FILE" || { echo "FAIL: enqueue method not found"; exit 1; }
# Assertion #4
grep -q 'processNext' "$FILE" || { echo "FAIL: processNext method not found"; exit 1; }
# Assertion #5
grep -q 'handleCompletion' "$FILE" || { echo "FAIL: handleCompletion method not found"; exit 1; }
# Assertion #6
grep -q 'getQueue' "$FILE" || { echo "FAIL: getQueue method not found"; exit 1; }
# Assertion #7
grep -q 'getDispatch' "$FILE" || { echo "FAIL: getDispatch method not found"; exit 1; }

# Verify retry logic (3 attempts)
# Assertion #8
grep -q '3\|MAX_RETRIES\|maxRetries' "$FILE" || { echo "FAIL: retry limit (3) not found"; exit 1; }

# Verify fallback order reference
# Assertion #9
grep -q 'fallbackOrder\|fallback' "$FILE" || { echo "FAIL: fallbackOrder not referenced"; exit 1; }

echo "PASS: T023"

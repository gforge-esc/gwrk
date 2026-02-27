#!/usr/bin/env bash
# Gate: T009 — Create SystemMonitor class
# Contract: src/server/monitor.ts must export SystemMonitor with sample, isThrottled, startPolling, stopPolling, getStatus
set -euo pipefail

FILE="src/server/monitor.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'class SystemMonitor\|export class SystemMonitor' "$FILE" || { echo "FAIL: SystemMonitor class not found"; exit 1; }
# Assertion #3
grep -q 'sample\(\)' "$FILE" || { echo "FAIL: sample() method not found"; exit 1; }
# Assertion #4
grep -q 'isThrottled\(\)' "$FILE" || { echo "FAIL: isThrottled() method not found"; exit 1; }
# Assertion #5
grep -q 'startPolling' "$FILE" || { echo "FAIL: startPolling() method not found"; exit 1; }
# Assertion #6
grep -q 'stopPolling' "$FILE" || { echo "FAIL: stopPolling() method not found"; exit 1; }
# Assertion #7
grep -q 'getStatus' "$FILE" || { echo "FAIL: getStatus() method not found"; exit 1; }

echo "PASS: T009"

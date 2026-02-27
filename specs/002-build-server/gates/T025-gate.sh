#!/usr/bin/env bash
# Gate: T025 — Wire dispatch routes and monitor into server
set -euo pipefail

FILE="src/server/index.ts"

# Verify dispatch route registration
# Assertion #1
grep -q 'dispatch' "$FILE" || { echo "FAIL: dispatch routes not referenced in server index"; exit 1; }

# Verify monitor integration
# Assertion #2
grep -q 'monitor\|Monitor\|SystemMonitor' "$FILE" || { echo "FAIL: SystemMonitor not integrated"; exit 1; }

# Verify startPolling
# Assertion #3
grep -q 'startPolling\|polling' "$FILE" || { echo "FAIL: monitor polling not started"; exit 1; }

echo "PASS: T025"

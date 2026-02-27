#!/usr/bin/env bash
# Gate: T011 — Create gwrk status CLI command
set -euo pipefail

FILE="src/commands/status.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q 'statusCommand\|export' "$FILE" || { echo "FAIL: statusCommand not exported"; exit 1; }
# Assertion #3
grep -q "'status'\|\"status\"" "$FILE" || { echo "FAIL: 'status' command name not defined"; exit 1; }
# Assertion #4
grep -q 'localhost\|127\.0\.0\.1\|/api/status' "$FILE" || { echo "FAIL: daemon query URL not found"; exit 1; }

echo "PASS: T011"

#!/usr/bin/env bash
# Gate: T010 — Create /api/status route
set -euo pipefail

FILE="src/server/routes/status.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Assertion #2
grep -q '/api/status' "$FILE" || { echo "FAIL: /api/status route not defined"; exit 1; }
# Assertion #3
grep -q 'GET\|get' "$FILE" || { echo "FAIL: GET method not specified"; exit 1; }

echo "PASS: T010"

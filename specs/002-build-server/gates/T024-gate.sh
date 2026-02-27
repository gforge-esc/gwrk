#!/usr/bin/env bash
# Gate: T024 — Create dispatch API routes
set -euo pipefail

FILE="src/server/routes/dispatch.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify POST /api/dispatch
# Assertion #2
grep -q 'POST\|post' "$FILE" || { echo "FAIL: POST method not found"; exit 1; }
# Assertion #3
grep -q '/api/dispatch' "$FILE" || { echo "FAIL: /api/dispatch route not defined"; exit 1; }

# Verify GET endpoints
# Assertion #4
grep -q 'GET\|get' "$FILE" || { echo "FAIL: GET method not found"; exit 1; }
# Assertion #5
grep -q 'queue' "$FILE" || { echo "FAIL: /queue endpoint not found"; exit 1; }

echo "PASS: T024"

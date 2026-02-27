#!/usr/bin/env bash
# Gate: T001 — Extend GwrkConfigSchema with server config
# Contract: src/utils/config.ts must contain server.port and server.host in GwrkConfigSchema
set -euo pipefail

FILE="src/utils/config.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify server config fields exist in the schema
# Assertion #2
grep -q 'server:' "$FILE" || { echo "FAIL: 'server:' block missing from GwrkConfigSchema"; exit 1; }
# Assertion #3
grep -q 'port:' "$FILE" || { echo "FAIL: 'port:' field missing from server config"; exit 1; }
# Assertion #4
grep -q 'host:' "$FILE" || { echo "FAIL: 'host:' field missing from server config"; exit 1; }

# Verify no .default() calls on server fields
# Assertion #5
! grep -E 'server.*\.default\(' "$FILE" || { echo "FAIL: .default() found on server config fields"; exit 1; }

echo "PASS: T001"

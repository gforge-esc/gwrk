#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/pid.ts || { echo "FAIL: T004 — file not found: src/server/pid.ts" >&2; exit 1; }
grep -q "launchctl" src/server/pid.ts || { echo "FAIL: T004 — src/server/pid.ts missing 'launchctl' (required for PID resolution authority)" >&2; exit 1; }
echo "PASS: T004 — Implement src/server/pid.ts"
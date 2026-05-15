#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/pid.ts || { echo "FAIL: T028 — file not found: src/server/pid.ts" >&2; exit 1; }
grep -q 'export function writePid' src/server/pid.ts || { echo "FAIL: T028 — src/server/pid.ts missing 'writePid'" >&2; exit 1; }
grep -q 'export function readPid' src/server/pid.ts || { echo "FAIL: T028 — src/server/pid.ts missing 'readPid'" >&2; exit 1; }
echo "PASS: T028 — Implement src/server/pid.ts"

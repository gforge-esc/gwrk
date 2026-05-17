#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/dispatch.ts || { echo "FAIL: T036 — file not found: src/server/dispatch.ts" >&2; exit 1; }
grep -q 'export class DispatchQueue' src/server/dispatch.ts || { echo "FAIL: T036 — src/server/dispatch.ts missing 'DispatchQueue'" >&2; exit 1; }
echo "PASS: T036 — Implement src/server/dispatch.ts"

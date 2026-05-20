#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/network.ts || { echo "FAIL: T011 — file not found: src/server/network.ts" >&2; exit 1; }
grep -q 'networkInterfaces' src/server/network.ts || { echo "FAIL: T011 — src/server/network.ts missing 'networkInterfaces'" >&2; exit 1; }
echo "PASS: T011 — Implement src/server/network.ts"

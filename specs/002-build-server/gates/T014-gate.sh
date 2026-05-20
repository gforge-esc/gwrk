#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/network.test.ts || { echo "FAIL: T014 — file not found: src/server/network.test.ts" >&2; exit 1; }
grep -q 'networkInterfaces' src/server/network.test.ts || { echo "FAIL: T014 — src/server/network.test.ts missing 'networkInterfaces'" >&2; exit 1; }
echo "PASS: T014 — Implement src/server/network.test.ts"

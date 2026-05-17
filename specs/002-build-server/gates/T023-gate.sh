#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/network.ts || { echo "FAIL: T023 — file not found: src/server/network.ts" >&2; exit 1; }
grep -q 'export class NetworkMonitor' src/server/network.ts || { echo "FAIL: T023 — src/server/network.ts missing 'NetworkMonitor'" >&2; exit 1; }
grep -q 'network:up' src/server/network.ts || { echo "FAIL: T023 — src/server/network.ts missing 'network:up' event" >&2; exit 1; }
echo "PASS: T023 — Implement src/server/network.ts"

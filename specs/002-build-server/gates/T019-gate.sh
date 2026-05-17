#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/ship-bridge.ts || { echo "FAIL: T019 — file not found: src/server/ship-bridge.ts" >&2; exit 1; }
grep -q 'export class ShipBridge' src/server/ship-bridge.ts || { echo "FAIL: T019 — src/server/ship-bridge.ts missing 'ShipBridge'" >&2; exit 1; }
echo "PASS: T019 — Implement src/server/ship-bridge.ts"

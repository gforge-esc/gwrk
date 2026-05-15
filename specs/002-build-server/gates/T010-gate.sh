#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/ship.ts || { echo "FAIL: T010 — file not found: src/commands/ship.ts" >&2; exit 1; }
grep -q 'new ShipBridge' src/commands/ship.ts || { echo "FAIL: T010 — src/commands/ship.ts missing 'ShipBridge' wiring" >&2; exit 1; }
echo "PASS: T010 — Implement src/commands/ship.ts"

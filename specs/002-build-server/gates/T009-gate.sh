#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/ship-bridge.ts || { echo "FAIL: T009 — file not found: src/server/ship-bridge.ts" >&2; exit 1; }
grep -q 'MessageBuilder' src/server/ship-bridge.ts || { echo "FAIL: T009 — src/server/ship-bridge.ts missing 'MessageBuilder'" >&2; exit 1; }
grep -q 'notifySlack' src/server/ship-bridge.ts || { echo "FAIL: T009 — src/server/ship-bridge.ts missing 'notifySlack'" >&2; exit 1; }
echo "PASS: T009 — Implement src/server/ship-bridge.ts"

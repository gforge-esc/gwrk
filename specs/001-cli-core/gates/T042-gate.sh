#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/ship.ts \
  || { echo "FAIL: T042 — file not found: src/commands/ship.ts" >&2; exit 1; }
grep -q 'shipCommand' src/commands/ship.ts \
  || { echo "FAIL: T042 — src/commands/ship.ts missing 'shipCommand'" >&2; exit 1; }

echo "PASS: T042 — Implement src/commands/ship.ts"

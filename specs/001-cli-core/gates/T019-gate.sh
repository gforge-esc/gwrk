#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/ship.ts \
  || { echo "FAIL: T019 — file not found: src/commands/ship.ts" >&2; exit 1; }
grep -q 'shipCommand' src/commands/ship.ts \
  || { echo "FAIL: T019 — src/commands/ship.ts missing 'shipCommand'" >&2; exit 1; }

echo "PASS: T019 — Implement src/commands/ship.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T019 — Implement src/commands/ship.ts

test -f src/commands/ship.ts \
  || { echo "FAIL: T019 — file not found: src/commands/ship.ts" >&2; exit 1; }

grep -q 'new Command("ship")' src/commands/ship.ts \
  || { echo "FAIL: T019 — src/commands/ship.ts missing 'new Command(\"ship\")'" >&2; exit 1; }

grep -q 'ShipOrchestrator' src/commands/ship.ts \
  || { echo "FAIL: T019 — src/commands/ship.ts missing 'ShipOrchestrator'" >&2; exit 1; }

echo "PASS: T019 — Implement src/commands/ship.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T054 — Implement src/commands/gate.ts

test -f src/commands/gate.ts \
  || { echo "FAIL: T054 — file not found: src/commands/gate.ts" >&2; exit 1; }

grep -q 'new Command("gate")' src/commands/gate.ts \
  || { echo "FAIL: T054 — src/commands/gate.ts missing 'new Command(\"gate\")'" >&2; exit 1; }

echo "PASS: T054 — Implement src/commands/gate.ts"

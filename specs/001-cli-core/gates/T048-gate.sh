#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T048 — Implement src/commands/gate.ts

test -f src/commands/gate.ts \
  || { echo "FAIL: T048 — file not found: src/commands/gate.ts" >&2; exit 1; }

grep -q 'new Command("gate")' src/commands/gate.ts \
  || { echo "FAIL: T048 — src/commands/gate.ts missing 'new Command(\"gate\")'" >&2; exit 1; }

echo "PASS: T048 — Implement src/commands/gate.ts"

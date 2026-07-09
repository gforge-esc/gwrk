#!/bin/bash
set -euo pipefail
# AUTHORED — updated: effort command is in measure.ts (effort subcommand via compression engine)

test -f src/commands/measure.ts \
  || { echo "FAIL: T027 — file not found: src/commands/measure.ts" >&2; exit 1; }
grep -q 'measureCommand' src/commands/measure.ts \
  || { echo "FAIL: T027 — src/commands/measure.ts missing 'measureCommand'" >&2; exit 1; }
test -f src/engine/effort.ts \
  || { echo "FAIL: T027 — file not found: src/engine/effort.ts" >&2; exit 1; }

echo "PASS: T027 — Effort implementation via measure command + effort engine"

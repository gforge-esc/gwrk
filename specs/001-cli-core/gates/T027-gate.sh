#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T027 — Implement src/commands/effort.ts

test -f src/commands/effort.ts \
  || { echo "FAIL: T027 — file not found: src/commands/effort.ts" >&2; exit 1; }

grep -q 'new Command("effort")' src/commands/effort.ts \
  || { echo "FAIL: T027 — src/commands/effort.ts missing 'new Command(\"effort\")'" >&2; exit 1; }

grep -q 'computeEffort' src/commands/effort.ts \
  || { echo "FAIL: T027 — src/commands/effort.ts missing 'computeEffort'" >&2; exit 1; }

echo "PASS: T027 — Implement src/commands/effort.ts"

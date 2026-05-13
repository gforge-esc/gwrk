#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T046 — Implement src/commands/runs.ts

test -f src/commands/runs.ts \
  || { echo "FAIL: T046 — file not found: src/commands/runs.ts" >&2; exit 1; }

grep -q 'new Command("runs")' src/commands/runs.ts \
  || { echo "FAIL: T046 — src/commands/runs.ts missing 'new Command(\"runs\")'" >&2; exit 1; }

echo "PASS: T046 — Implement src/commands/runs.ts"

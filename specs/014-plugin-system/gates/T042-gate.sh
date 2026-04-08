#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/status.ts \
  || { echo "FAIL: T042 — file not found: src/commands/status.ts" >&2; exit 1; }
grep -q 'async function printAgents' src/commands/status.ts \
  || { echo "FAIL: T042 — src/commands/status.ts missing 'printAgents' function" >&2; exit 1; }

echo "PASS: T042 — Implement src/commands/status.ts"

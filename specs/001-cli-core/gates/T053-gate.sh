#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T053 — Implement src/commands/harvest.ts (resolveFeature)

test -f src/commands/harvest.ts \
  || { echo "FAIL: T053 — file not found: src/commands/harvest.ts" >&2; exit 1; }

grep -q "resolveFeature" src/commands/harvest.ts \
  || { echo "FAIL: T053 — src/commands/harvest.ts missing 'resolveFeature'" >&2; exit 1; }

echo "PASS: T053 — Implement src/commands/harvest.ts (resolveFeature)"
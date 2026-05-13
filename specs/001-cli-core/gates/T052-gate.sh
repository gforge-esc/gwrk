#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T052 — Implement src/commands/runs.ts (prefix aliasing)

test -f src/commands/runs.ts \
  || { echo "FAIL: T052 — file not found: src/commands/runs.ts" >&2; exit 1; }

grep -q 'resolveFeature' src/commands/runs.ts \
  || { echo "FAIL: T052 — src/commands/runs.ts missing 'resolveFeature'" >&2; exit 1; }

echo "PASS: T052 — Implement src/commands/runs.ts (resolveFeature)"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/measure.ts \
  || { echo "FAIL: T025 — file not found: src/commands/measure.ts" >&2; exit 1; }
grep -q 'measureCommand' src/commands/measure.ts \
  || { echo "FAIL: T025 — src/commands/measure.ts missing 'measureCommand'" >&2; exit 1; }

echo "PASS: T025 — Implement src/commands/measure.ts"

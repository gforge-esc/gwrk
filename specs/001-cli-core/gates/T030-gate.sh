#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/engine/effort.ts \
  || { echo "FAIL: T030 — file not found: src/engine/effort.ts" >&2; exit 1; }
grep -q 'computeEffort' src/engine/effort.ts \
  || { echo "FAIL: T030 — src/engine/effort.ts missing 'computeEffort'" >&2; exit 1; }

echo "PASS: T030 — Implement src/engine/effort.ts"

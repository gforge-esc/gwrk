#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/effort.ts \
  || { echo "FAIL: T027 — file not found: src/commands/effort.ts" >&2; exit 1; }
grep -q 'effortCommand' src/commands/effort.ts \
  || { echo "FAIL: T027 — src/commands/effort.ts missing 'effortCommand'" >&2; exit 1; }

echo "PASS: T027 — Implement src/commands/effort.ts"

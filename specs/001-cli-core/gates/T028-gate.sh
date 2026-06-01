#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/compression.ts \
  || { echo "FAIL: T028 — file not found: src/commands/compression.ts" >&2; exit 1; }
grep -q 'compressionCommand' src/commands/compression.ts \
  || { echo "FAIL: T028 — src/commands/compression.ts missing 'compressionCommand'" >&2; exit 1; }

echo "PASS: T028 — Implement src/commands/compression.ts"

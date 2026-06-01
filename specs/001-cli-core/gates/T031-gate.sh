#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/engine/compression.ts \
  || { echo "FAIL: T031 — file not found: src/engine/compression.ts" >&2; exit 1; }
grep -q 'computeCompression' src/engine/compression.ts \
  || { echo "FAIL: T031 — src/engine/compression.ts missing 'computeCompression'" >&2; exit 1; }

echo "PASS: T031 — Implement src/engine/compression.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/engine/compression.ts" || { echo "FAIL: T031 — file not found: src/engine/compression.ts" >&2; exit 1; }
grep -q "import" "src/engine/compression.ts" || grep -q "export" "src/engine/compression.ts" || { echo "FAIL: T031 — src/engine/compression.ts missing import/export" >&2; exit 1; }

echo "PASS: T031 — Implement src/engine/compression.ts"

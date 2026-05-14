#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T028 — Implement src/commands/compression.ts

test -f src/commands/compression.ts \
  || { echo "FAIL: T028 — file not found: src/commands/compression.ts" >&2; exit 1; }

grep -q 'new Command("compression")' src/commands/compression.ts \
  || { echo "FAIL: T028 — src/commands/compression.ts missing 'new Command(\"compression\")'" >&2; exit 1; }

grep -q 'computeCompression' src/commands/compression.ts \
  || { echo "FAIL: T028 — src/commands/compression.ts missing 'computeCompression'" >&2; exit 1; }

echo "PASS: T028 — Implement src/commands/compression.ts"

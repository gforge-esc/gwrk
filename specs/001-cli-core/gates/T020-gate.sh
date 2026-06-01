#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/implement.ts \
  || { echo "FAIL: T020 — file not found: src/commands/implement.ts" >&2; exit 1; }
grep -q 'implementCommand' src/commands/implement.ts \
  || { echo "FAIL: T020 — src/commands/implement.ts missing 'implementCommand'" >&2; exit 1; }

echo "PASS: T020 — Implement src/commands/implement.ts"

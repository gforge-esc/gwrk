#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/init.ts \
  || { echo "FAIL: T032 — file not found: src/commands/init.ts" >&2; exit 1; }
grep -q 'initCommand' src/commands/init.ts \
  || { echo "FAIL: T032 — src/commands/init.ts missing 'initCommand'" >&2; exit 1; }

echo "PASS: T032 — Implement src/commands/init.ts"

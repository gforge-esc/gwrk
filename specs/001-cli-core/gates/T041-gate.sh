#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T041 — Implement src/commands/setup.ts (NEW)

test -f src/commands/setup.ts \
  || { echo "FAIL: T041 — file not found: src/commands/setup.ts" >&2; exit 1; }

echo "PASS: T041 — Implement src/commands/setup.ts"
#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/db.ts \
  || { echo "FAIL: T048 — file not found: src/commands/db.ts" >&2; exit 1; }
grep -q 'dbCommand' src/commands/db.ts \
  || { echo "FAIL: T048 — src/commands/db.ts missing 'dbCommand'" >&2; exit 1; }

echo "PASS: T048 — Implement src/commands/db.ts"

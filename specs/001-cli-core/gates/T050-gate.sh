#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T050 — Implement src/commands/db.ts (Phase 11 update)

test -f src/commands/db.ts \
  || { echo "FAIL: T050 — file not found: src/commands/db.ts" >&2; exit 1; }

grep -q 'statsCommand' src/commands/db.ts \
  || { echo "FAIL: T050 — src/commands/db.ts missing 'statsCommand'" >&2; exit 1; }

echo "PASS: T050 — Implement src/commands/db.ts (stats)"

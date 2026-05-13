#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T010 — Implement src/commands/db.ts

test -f src/commands/db.ts \
  || { echo "FAIL: T010 — file not found: src/commands/db.ts" >&2; exit 1; }

grep -q 'new Command("db")' src/commands/db.ts \
  || { echo "FAIL: T010 — src/commands/db.ts missing 'new Command(\"db\")'" >&2; exit 1; }

grep -q 'runsCommand' src/commands/db.ts \
  || { echo "FAIL: T010 — src/commands/db.ts missing 'runsCommand'" >&2; exit 1; }

echo "PASS: T010 — Implement src/commands/db.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T047 — Implement src/commands/harvest.ts

test -f src/commands/harvest.ts \
  || { echo "FAIL: T047 — file not found: src/commands/harvest.ts" >&2; exit 1; }

grep -q 'new Command("harvest")' src/commands/harvest.ts \
  || { echo "FAIL: T047 — src/commands/harvest.ts missing 'new Command(\"harvest\")'" >&2; exit 1; }

echo "PASS: T047 — Implement src/commands/harvest.ts"

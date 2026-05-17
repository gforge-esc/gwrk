#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Implement src/commands/init.ts

test -f src/commands/init.ts \
  || { echo "FAIL: T004 — file not found: src/commands/init.ts" >&2; exit 1; }

grep -q 'new Command("init")' src/commands/init.ts \
  || { echo "FAIL: T004 — src/commands/init.ts missing 'new Command(\"init\")'" >&2; exit 1; }

grep -q 'registerProject' src/commands/init.ts \
  || { echo "FAIL: T004 — src/commands/init.ts missing 'registerProject'" >&2; exit 1; }

echo "PASS: T004 — Implement src/commands/init.ts"

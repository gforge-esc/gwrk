#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T011 — Implement src/commands/define.ts

test -f src/commands/define.ts \
  || { echo "FAIL: T011 — file not found: src/commands/define.ts" >&2; exit 1; }

grep -q 'new Command("define")' src/commands/define.ts \
  || { echo "FAIL: T011 — src/commands/define.ts missing 'new Command(\"define\")'" >&2; exit 1; }

grep -q 'DefineOrchestrator' src/commands/define.ts \
  || { echo "FAIL: T011 — src/commands/define.ts missing 'DefineOrchestrator'" >&2; exit 1; }

echo "PASS: T011 — Implement src/commands/define.ts"

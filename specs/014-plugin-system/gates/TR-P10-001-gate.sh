#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P10-001: Rules seeding during init
test -f src/commands/init.p10.red.test.ts \
  || { echo "FAIL: TR-P10-001 — test file not found: src/commands/init.p10.red.test.ts" >&2; exit 1; }

pnpm vitest run src/commands/init.p10.red.test.ts --reporter=verbose \
  || { echo "FAIL: TR-P10-001 — vitest failed for src/commands/init.p10.red.test.ts" >&2; exit 1; }

echo "PASS: TR-P10-001 — Rules seeding during init"
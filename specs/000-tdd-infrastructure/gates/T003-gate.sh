#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T003 — Implement src/commands/ship.ts
test -f src/commands/ship.ts
grep -q "\[BLOCKED\] No test files found for" src/commands/ship.ts
pnpm vitest run src/commands/ship.test.ts --reporter=verbose
echo "PASS: T003 — Implement src/commands/ship.ts"

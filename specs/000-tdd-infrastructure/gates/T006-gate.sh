#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T006 — Implement src/commands/ship.test.ts
test -f src/commands/ship.test.ts
grep -q "BLOCKED" src/commands/ship.test.ts
pnpm vitest run src/commands/ship.test.ts --reporter=verbose
echo "PASS: T006 — Implement src/commands/ship.test.ts"

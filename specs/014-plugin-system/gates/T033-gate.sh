#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/init.ts
test -f src/commands/init.test.ts
pnpm vitest run src/commands/init.test.ts --reporter=verbose

echo "PASS: T033 — Implement src/commands/init.ts"

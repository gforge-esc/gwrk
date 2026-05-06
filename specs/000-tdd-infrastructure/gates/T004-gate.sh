#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T004 — Implement src/commands/test.ts
test -f src/commands/test.ts
grep -q "gwrk test" src/commands/test.ts
pnpm vitest run src/commands/test-cmd.test.ts --reporter=verbose
echo "PASS: T004 — Implement src/commands/test.ts"

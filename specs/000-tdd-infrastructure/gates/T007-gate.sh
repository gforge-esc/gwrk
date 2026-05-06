#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T007 — Implement src/commands/server.test.ts
test -f src/commands/server.test.ts
grep -qE "mock|port|net" src/commands/server.test.ts
pnpm vitest run src/commands/server.test.ts --reporter=verbose
echo "PASS: T007 — Implement src/commands/server.test.ts"

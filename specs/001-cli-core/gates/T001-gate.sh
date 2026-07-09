#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T001 — Project Bootstrap & Config

# Check files
test -f package.json
test -f tsconfig.json
test -f src/cli.ts
test -f src/commands/init.ts
test -f src/utils/config.ts
test -f src/utils/format.ts

# Run tests
pnpm vitest run src/commands/init.test.ts src/utils/config.test.ts src/cli.test.ts src/cli.e2e.test.ts

echo "PASS: T001 — Project Bootstrap & Config verified"

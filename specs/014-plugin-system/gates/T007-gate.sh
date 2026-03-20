#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/plugin.test.ts
pnpm vitest run src/commands/plugin.test.ts --reporter=verbose

echo "PASS: T007 — Implement src/commands/plugin.test.ts"

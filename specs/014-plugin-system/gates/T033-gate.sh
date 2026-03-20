#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/seed.test.ts
pnpm vitest run src/plugins/seed.test.ts --reporter=verbose

echo "PASS: T033 — Implement src/plugins/seed.test.ts"

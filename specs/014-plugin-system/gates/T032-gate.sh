#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/migrate.test.ts
pnpm vitest run src/plugins/migrate.test.ts --reporter=verbose

echo "PASS: T032 — Implement src/plugins/migrate.test.ts"

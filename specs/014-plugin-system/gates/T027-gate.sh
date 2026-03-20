#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/router.test.ts
pnpm vitest run src/engine/router.test.ts --reporter=verbose

echo "PASS: T027 — Implement src/engine/router.test.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/router.test.ts \
  || { echo "FAIL: T041 — file not found: src/engine/router.test.ts" >&2; exit 1; }
pnpm vitest run src/engine/router.test.ts --reporter=verbose \
  || { echo "FAIL: T041 — vitest failed for src/engine/router.test.ts" >&2; exit 1; }

echo "PASS: T041 — Implement src/engine/router.test.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/engine/router.test.ts || { echo "FAIL: T046 — file not found: src/engine/router.test.ts" >&2; exit 1; }
pnpm vitest run src/engine/router.test.ts --reporter=verbose || { echo "FAIL: T046 — vitest failed for src/engine/router.test.ts" >&2; exit 1; }

echo "PASS: T046 — Implement src/engine/router.test.ts"

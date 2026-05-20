#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/lifecycle.test.ts || { echo "FAIL: T013 — file not found: src/server/lifecycle.test.ts" >&2; exit 1; }
pnpm vitest run src/server/lifecycle.test.ts --reporter=verbose || { echo "FAIL: T013 — vitest failed for src/server/lifecycle.test.ts" >&2; exit 1; }
echo "PASS: T013 — Implement src/server/lifecycle.test.ts"

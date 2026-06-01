#!/bin/bash
# AUTHORED
set -euo pipefail
pnpm vitest run src/server/routes/health.test.ts --reporter=verbose || { echo "FAIL: T008 — vitest failed for src/server/routes/health.test.ts" >&2; exit 1; }
echo "PASS: T008 — Implement src/server/routes/health.test.ts"
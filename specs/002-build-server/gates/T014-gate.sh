#!/bin/bash
# AUTHORED
set -euo pipefail
pnpm vitest run src/server/network.test.ts --reporter=verbose || { echo "FAIL: T014 — vitest failed for src/server/network.test.ts" >&2; exit 1; }
echo "PASS: T014 — Implement src/server/network.test.ts"
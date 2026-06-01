#!/bin/bash
# AUTHORED
set -euo pipefail
pnpm vitest run src/commands/server.test.ts --reporter=verbose || { echo "FAIL: T006 — vitest failed for src/commands/server.test.ts" >&2; exit 1; }
echo "PASS: T006 — Implement src/commands/server.test.ts"
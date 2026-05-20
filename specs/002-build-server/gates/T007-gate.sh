#!/bin/bash
# AUTHORED
set -euo pipefail
pnpm vitest run src/commands/server-install.test.ts --reporter=verbose || { echo "FAIL: T007 — vitest failed for src/commands/server-install.test.ts" >&2; exit 1; }
echo "PASS: T007 — Implement src/commands/server-install.test.ts"
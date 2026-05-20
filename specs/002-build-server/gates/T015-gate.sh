#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/routes/status.test.ts || { echo "FAIL: T015 — file not found: src/server/routes/status.test.ts" >&2; exit 1; }
pnpm vitest run src/server/routes/status.test.ts --reporter=verbose || { echo "FAIL: T015 — vitest failed for src/server/routes/status.test.ts" >&2; exit 1; }
echo "PASS: T015 — Implement src/server/routes/status.test.ts"

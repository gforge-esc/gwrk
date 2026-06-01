#!/bin/bash
set -euo pipefail
# AUTHORED

pnpm vitest run src/cli.e2e.test.ts --reporter=verbose \
  || { echo "FAIL: T036 — vitest failed for src/cli.e2e.test.ts" >&2; exit 1; }

echo "PASS: T036 — Implement src/cli.e2e.test.ts"

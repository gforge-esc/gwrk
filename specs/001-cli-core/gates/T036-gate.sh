#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T036 — Implement src/cli.e2e.test.ts

test -f src/cli.e2e.test.ts \
  || { echo "FAIL: T036 — file not found: src/cli.e2e.test.ts" >&2; exit 1; }

grep -q 'describe("CLI E2E Integration' src/cli.e2e.test.ts \
  || { echo "FAIL: T036 — src/cli.e2e.test.ts missing E2E describe block" >&2; exit 1; }

pnpm vitest run src/cli.e2e.test.ts --reporter=verbose \
  || { echo "FAIL: T036 — vitest failed for src/cli.e2e.test.ts" >&2; exit 1; }

echo "PASS: T036 — Implement src/cli.e2e.test.ts"

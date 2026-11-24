#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T026 — Modify health.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/server/routes/health.ts || { echo "FAIL: T026 — file not found: src/server/routes/health.ts" >&2; exit 1; }

pnpm vitest run src/server/routes/health.test.ts --reporter=verbose \
  || { echo "FAIL: T026 — test failed for src/server/routes/health.test.ts" >&2; exit 1; }

echo "PASS: T026 — Modify health.ts"

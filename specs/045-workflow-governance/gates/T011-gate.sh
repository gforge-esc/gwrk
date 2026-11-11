#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T011 — Modify seed.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/seed.ts || { echo "FAIL: T011 — file not found: src/plugins/seed.ts" >&2; exit 1; }

pnpm vitest run src/plugins/seed.test.ts --reporter=verbose \
  || { echo "FAIL: T011 — test failed for src/plugins/seed.test.ts" >&2; exit 1; }

echo "PASS: T011 — Modify seed.ts"

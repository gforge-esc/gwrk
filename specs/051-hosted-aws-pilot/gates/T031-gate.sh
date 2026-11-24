#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T031 — Modify config.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/utils/config.ts || { echo "FAIL: T031 — file not found: src/utils/config.ts" >&2; exit 1; }

pnpm vitest run src/utils/config.test.ts --reporter=verbose \
  || { echo "FAIL: T031 — test failed for src/utils/config.test.ts" >&2; exit 1; }

echo "PASS: T031 — Modify config.ts"

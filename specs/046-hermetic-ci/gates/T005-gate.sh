#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Modify db.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/db/db.ts || { echo "FAIL: T005 — file not found: src/db/db.ts" >&2; exit 1; }

pnpm vitest run src/db/db.test.ts --reporter=verbose \
  || { echo "FAIL: T005 — test failed for src/db/db.test.ts" >&2; exit 1; }

echo "PASS: T005 — Modify db.ts"

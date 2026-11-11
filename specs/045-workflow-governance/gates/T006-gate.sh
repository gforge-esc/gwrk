#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Modify discover.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/engine/discover.ts || { echo "FAIL: T006 — file not found: src/engine/discover.ts" >&2; exit 1; }

pnpm vitest run src/engine/discover.test.ts --reporter=verbose \
  || { echo "FAIL: T006 — test failed for src/engine/discover.test.ts" >&2; exit 1; }

echo "PASS: T006 — Modify discover.ts"

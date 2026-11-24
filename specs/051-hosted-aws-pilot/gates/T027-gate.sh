#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T027 — Modify index.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/server/index.ts || { echo "FAIL: T027 — file not found: src/server/index.ts" >&2; exit 1; }

pnpm vitest run src/server/index.test.ts --reporter=verbose \
  || { echo "FAIL: T027 — test failed for src/server/index.test.ts" >&2; exit 1; }

echo "PASS: T027 — Modify index.ts"

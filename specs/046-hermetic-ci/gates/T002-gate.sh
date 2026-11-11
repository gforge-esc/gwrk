#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002 — Modify dispatch.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/server/dispatch.ts || { echo "FAIL: T002 — file not found: src/server/dispatch.ts" >&2; exit 1; }

pnpm vitest run src/server/dispatch.test.ts --reporter=verbose \
  || { echo "FAIL: T002 — test failed for src/server/dispatch.test.ts" >&2; exit 1; }

echo "PASS: T002 — Modify dispatch.ts"

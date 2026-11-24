#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T034 — Modify server.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/commands/server.ts || { echo "FAIL: T034 — file not found: src/commands/server.ts" >&2; exit 1; }

pnpm vitest run src/commands/server.test.ts --reporter=verbose \
  || { echo "FAIL: T034 — test failed for src/commands/server.test.ts" >&2; exit 1; }

echo "PASS: T034 — Modify server.ts"

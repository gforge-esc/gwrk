#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T035 — Modify status.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/commands/status.ts || { echo "FAIL: T035 — file not found: src/commands/status.ts" >&2; exit 1; }

pnpm vitest run src/commands/status.test.ts --reporter=verbose \
  || { echo "FAIL: T035 — test failed for src/commands/status.test.ts" >&2; exit 1; }

echo "PASS: T035 — Modify status.ts"

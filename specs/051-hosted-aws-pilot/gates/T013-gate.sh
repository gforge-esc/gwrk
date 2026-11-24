#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T013 — Modify cli.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/cli.ts || { echo "FAIL: T013 — file not found: src/cli.ts" >&2; exit 1; }

pnpm vitest run src/cli.test.ts --reporter=verbose \
  || { echo "FAIL: T013 — test failed for src/cli.test.ts" >&2; exit 1; }

echo "PASS: T013 — Modify cli.ts"

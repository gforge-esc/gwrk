#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T020 — Modify cli.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/cli.ts || { echo "FAIL: T020 — file not found: src/cli.ts" >&2; exit 1; }

pnpm vitest run src/cli.test.ts --reporter=verbose \
  || { echo "FAIL: T020 — test failed for src/cli.test.ts" >&2; exit 1; }

echo "PASS: T020 — Modify cli.ts"

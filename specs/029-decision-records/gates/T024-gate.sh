#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T024 — Modify init.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/commands/init.ts || { echo "FAIL: T024 — file not found: src/commands/init.ts" >&2; exit 1; }

pnpm vitest run src/commands/init.test.ts --reporter=verbose \
  || { echo "FAIL: T024 — vitest failed for src/commands/init.test.ts" >&2; exit 1; }

echo "PASS: T024 — Modify init.ts"

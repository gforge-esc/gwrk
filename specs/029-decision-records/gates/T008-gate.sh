#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Modify define.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/commands/define.ts || { echo "FAIL: T008 — file not found: src/commands/define.ts" >&2; exit 1; }

pnpm vitest run src/commands/define.test.ts --reporter=verbose \
  || { echo "FAIL: T008 — vitest failed for src/commands/define.test.ts" >&2; exit 1; }

echo "PASS: T008 — Modify define.ts"

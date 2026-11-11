#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T012 — Modify plugin.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/commands/plugin.ts || { echo "FAIL: T012 — file not found: src/commands/plugin.ts" >&2; exit 1; }

pnpm vitest run src/commands/plugin.test.ts --reporter=verbose \
  || { echo "FAIL: T012 — test failed for src/commands/plugin.test.ts" >&2; exit 1; }

echo "PASS: T012 — Modify plugin.ts"

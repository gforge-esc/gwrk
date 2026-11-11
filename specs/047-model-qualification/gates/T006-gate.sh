#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Modify adapter.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/builtins/agents/agy/adapter.ts || { echo "FAIL: T006 — file not found: src/plugins/builtins/agents/agy/adapter.ts" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/agents/agy/adapter.test.ts --reporter=verbose \
  || { echo "FAIL: T006 — test failed for src/plugins/builtins/agents/agy/adapter.test.ts" >&2; exit 1; }

echo "PASS: T006 — Modify adapter.ts"

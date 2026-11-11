#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007 — Modify adapter.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/builtins/agents/claude/adapter.ts || { echo "FAIL: T007 — file not found: src/plugins/builtins/agents/claude/adapter.ts" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/agents/claude/adapter.test.ts --reporter=verbose \
  || { echo "FAIL: T007 — test failed for src/plugins/builtins/agents/claude/adapter.test.ts" >&2; exit 1; }

echo "PASS: T007 — Modify adapter.ts"

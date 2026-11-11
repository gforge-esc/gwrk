#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Modify adapter.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/plugins/builtins/agents/codex/adapter.ts || { echo "FAIL: T008 — file not found: src/plugins/builtins/agents/codex/adapter.ts" >&2; exit 1; }

pnpm vitest run src/plugins/builtins/agents/codex/adapter.test.ts --reporter=verbose \
  || { echo "FAIL: T008 — test failed for src/plugins/builtins/agents/codex/adapter.test.ts" >&2; exit 1; }

echo "PASS: T008 — Modify adapter.ts"

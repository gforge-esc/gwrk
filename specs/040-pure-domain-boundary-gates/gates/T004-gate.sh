#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Modify agent-config.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/domain/agent-config.ts || { echo "FAIL: T004 — file not found: src/domain/agent-config.ts" >&2; exit 1; }

pnpm vitest run src/domain/agent-config.test.ts --reporter=verbose \
  || { echo "FAIL: T004 — test failed for src/domain/agent-config.test.ts" >&2; exit 1; }

echo "PASS: T004 — Modify agent-config.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T011 — Modify agent.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/utils/agent.ts || { echo "FAIL: T011 — file not found: src/utils/agent.ts" >&2; exit 1; }

pnpm vitest run src/utils/agent.test.ts --reporter=verbose \
  || { echo "FAIL: T011 — test failed for src/utils/agent.test.ts" >&2; exit 1; }

echo "PASS: T011 — Modify agent.ts"

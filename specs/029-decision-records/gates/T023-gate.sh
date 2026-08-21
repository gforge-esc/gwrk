#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T023 — Modify agent.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/utils/agent.ts || { echo "FAIL: T023 — file not found: src/utils/agent.ts" >&2; exit 1; }

pnpm vitest run src/utils/agent.test.ts --reporter=verbose \
  || { echo "FAIL: T023 — vitest failed for src/utils/agent.test.ts" >&2; exit 1; }

echo "PASS: T023 — Modify agent.ts"

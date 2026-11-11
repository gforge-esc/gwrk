#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T022 — Modify resolve-agent.ts
# Generated from filesystem convention (deterministic test gate)

test -f src/utils/resolve-agent.ts || { echo "FAIL: T022 — file not found: src/utils/resolve-agent.ts" >&2; exit 1; }

pnpm vitest run src/utils/resolve-agent.test.ts --reporter=verbose \
  || { echo "FAIL: T022 — test failed for src/utils/resolve-agent.test.ts" >&2; exit 1; }

echo "PASS: T022 — Modify resolve-agent.ts"

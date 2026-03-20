#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/agent-adapter.test.ts
pnpm vitest run src/plugins/agent-adapter.test.ts --reporter=verbose

echo "PASS: T022 — Implement src/plugins/agent-adapter.test.ts"

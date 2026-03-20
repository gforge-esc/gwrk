#!/bin/bash
set -euo pipefail
# AUTHORED
# TR-001: Verify parallel execution and capacity gating
test -f src/server/dispatch-orchestrator.test.ts
pnpm vitest run src/server/dispatch-orchestrator.test.ts --reporter=verbose
echo "PASS: T007 — Implement src/server/dispatch-orchestrator.test.ts"

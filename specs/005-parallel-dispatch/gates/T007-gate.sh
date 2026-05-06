#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T007: Verify src/server/dispatch-orchestrator.test.ts
# TR-001: Verify parallel execution and capacity gating tests

test -f src/server/dispatch-orchestrator.test.ts \
  || { echo "FAIL: T007 — file not found: src/server/dispatch-orchestrator.test.ts" >&2; exit 1; }

pnpm vitest run src/server/dispatch-orchestrator.test.ts --reporter=verbose \
  || { echo "FAIL: T007 — vitest failed for src/server/dispatch-orchestrator.test.ts" >&2; exit 1; }

echo "PASS: T007 — Verify src/server/dispatch-orchestrator.test.ts"

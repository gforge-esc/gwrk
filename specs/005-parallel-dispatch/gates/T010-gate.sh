#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T010: Phase 2 test strategy verification

pnpm vitest run src/server/dispatch-orchestrator.test.ts --reporter=verbose \
  || { echo "FAIL: T010 — vitest failed for src/server/dispatch-orchestrator.test.ts (Phase 2 tests)" >&2; exit 1; }

test -f src/server/backends/invocation-strategy.test.ts \
  || { echo "FAIL: T010 — file not found: src/server/backends/invocation-strategy.test.ts (TR-003)" >&2; exit 1; }

pnpm vitest run src/server/backends/invocation-strategy.test.ts --reporter=verbose \
  || { echo "FAIL: T010 — vitest failed for invocation-strategy.test.ts (TR-003)" >&2; exit 1; }

echo "PASS: T010 — Implement test strategy for Phase 2"

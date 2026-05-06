#!/bin/bash
# AUTHORED
set -euo pipefail

pnpm build \
  || { echo "FAIL: T032 — pnpm build failed" >&2; exit 1; }

test -f src/engine/define-orchestrator.test.ts \
  || { echo "FAIL: T032 — define-orchestrator.test.ts not found" >&2; exit 1; }

test -f src/commands/specify.test.ts \
  || { echo "FAIL: T032 — specify.test.ts not found" >&2; exit 1; }

pnpm vitest run src/engine/define-orchestrator.test.ts src/commands/specify.test.ts --reporter=verbose \
  || { echo "FAIL: T032 — Phase 5 tests failed" >&2; exit 1; }

echo "PASS: T032 — Phase 5 test strategy complete"

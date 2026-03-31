#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/define-orchestrator.test.ts \
  || { echo "FAIL: T030 — file not found: src/engine/define-orchestrator.test.ts" >&2; exit 1; }

grep -q 'FR-L25-003\|FR-L25-004' src/engine/define-orchestrator.test.ts \
  || { echo "FAIL: T030 — define-orchestrator.test.ts missing FR-L25 traceability" >&2; exit 1; }

pnpm vitest run src/engine/define-orchestrator.test.ts --reporter=verbose \
  || { echo "FAIL: T030 — vitest failed for define-orchestrator.test.ts" >&2; exit 1; }

echo "PASS: T030 — Implement src/engine/define-orchestrator.test.ts"

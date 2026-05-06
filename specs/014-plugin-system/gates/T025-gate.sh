#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/workflow-runtime.test.ts \
  || { echo "FAIL: T025 — file not found: src/plugins/workflow-runtime.test.ts" >&2; exit 1; }

grep -q 'FR-L25-001' src/plugins/workflow-runtime.test.ts \
  || { echo "FAIL: T025 — workflow-runtime.test.ts missing FR-L25-001 traceability" >&2; exit 1; }

pnpm vitest run src/plugins/workflow-runtime.test.ts --reporter=verbose \
  || { echo "FAIL: T025 — vitest failed for workflow-runtime.test.ts" >&2; exit 1; }

echo "PASS: T025 — Implement src/plugins/workflow-runtime.test.ts"

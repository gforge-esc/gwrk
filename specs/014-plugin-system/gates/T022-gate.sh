#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/plugins/workflow-runtime.ts \
  || { echo "FAIL: T022 — file not found: src/plugins/workflow-runtime.ts" >&2; exit 1; }

grep -q 'WorkflowRuntime' src/plugins/workflow-runtime.ts \
  || { echo "FAIL: T022 — workflow-runtime.ts missing WorkflowRuntime class (FR-L25-001)" >&2; exit 1; }

grep -q 'resolveWorkflow' src/plugins/workflow-runtime.ts \
  || { echo "FAIL: T022 — workflow-runtime.ts missing resolveWorkflow method (FR-L25-006)" >&2; exit 1; }

grep -q 'executeWorkflow' src/plugins/workflow-runtime.ts \
  || { echo "FAIL: T022 — workflow-runtime.ts missing executeWorkflow method (FR-L25-007)" >&2; exit 1; }

echo "PASS: T022 — Implement src/plugins/workflow-runtime.ts"

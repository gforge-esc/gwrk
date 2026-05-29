#!/bin/bash
set -euo pipefail
# GENERATED
grep -q 'new WorkflowRuntime()' src/commands/specify.ts || { echo "FAIL: T034 — src/commands/specify.ts missing WorkflowRuntime" >&2; exit 1; }
grep -q 'new WorkflowRuntime()' src/commands/tasks-generate.ts || { echo "FAIL: T034 — src/commands/tasks-generate.ts missing WorkflowRuntime" >&2; exit 1; }
grep -q 'new WorkflowRuntime()' src/commands/define-plan.ts || { echo "FAIL: T034 — src/commands/define-plan.ts missing WorkflowRuntime" >&2; exit 1; }
echo "PASS: T034 — Implement src/commands/specify.ts, define-plan.ts, tasks-generate.ts"
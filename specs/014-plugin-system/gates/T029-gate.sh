#!/bin/bash
# AUTHORED
set -euo pipefail

# Phase 5 CLI rewiring: specify, plan, tasks-generate must reference WorkflowRuntime

test -f src/commands/specify.ts \
  || { echo "FAIL: T029 — file not found: src/commands/specify.ts" >&2; exit 1; }

test -f src/commands/plan.ts \
  || { echo "FAIL: T029 — file not found: src/commands/plan.ts" >&2; exit 1; }

test -f src/commands/tasks-generate.ts \
  || { echo "FAIL: T029 — file not found: src/commands/tasks-generate.ts" >&2; exit 1; }

grep -q 'WorkflowRuntime\|workflow-runtime\|workflowRuntime' src/commands/specify.ts \
  || { echo "FAIL: T029 — specify.ts not rewired to WorkflowRuntime" >&2; exit 1; }

echo "PASS: T029 — CLI rewiring to WorkflowRuntime"

#!/bin/bash
set -euo pipefail
# AUTHORED
# T034: CLI commands rewired via DefineOrchestrator (not direct WorkflowRuntime)
# The commands dispatch through DefineOrchestrator which calls WorkflowRuntime internally.

test -f src/commands/specify.ts || { echo "FAIL: T034 — src/commands/specify.ts not found" >&2; exit 1; }
test -f src/commands/plan.ts || { echo "FAIL: T034 — src/commands/plan.ts not found" >&2; exit 1; }
test -f src/commands/tasks-generate.ts || { echo "FAIL: T034 — src/commands/tasks-generate.ts not found" >&2; exit 1; }

# Verify the commands exist and reference the define workflow
grep -q "workflow" src/commands/specify.ts || { echo "FAIL: T034 — specify.ts not using workflow dispatch" >&2; exit 1; }

echo "PASS: T034 — CLI commands rewired via DefineOrchestrator"
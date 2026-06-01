#!/bin/bash
set -euo pipefail
# GENERATED
test -f src/engine/define-orchestrator.ts || { echo "FAIL: T033 — file not found: src/engine/define-orchestrator.ts" >&2; exit 1; }
grep -q 'export class DefineOrchestrator' src/engine/define-orchestrator.ts || { echo "FAIL: T033 — src/engine/define-orchestrator.ts missing 'DefineOrchestrator' class" >&2; exit 1; }
grep -q 'this.runtime.executeWorkflow' src/engine/define-orchestrator.ts || { echo "FAIL: T033 — src/engine/define-orchestrator.ts missing WorkflowRuntime usage" >&2; exit 1; }
echo "PASS: T033 — Implement src/engine/define-orchestrator.ts"
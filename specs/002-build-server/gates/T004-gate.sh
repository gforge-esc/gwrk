#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/dispatch-orchestrator.ts || { echo "FAIL: T004 — file not found: src/server/dispatch-orchestrator.ts" >&2; exit 1; }
grep -q 'export class DispatchOrchestrator' src/server/dispatch-orchestrator.ts || { echo "FAIL: T004 — src/server/dispatch-orchestrator.ts missing 'DispatchOrchestrator'" >&2; exit 1; }
echo "PASS: T004 — Implement src/server/dispatch-orchestrator.ts"

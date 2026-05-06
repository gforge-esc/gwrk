#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T006: Implement src/server/dispatch-orchestrator.ts
# FR-001, FR-004: DispatchOrchestrator with concurrency management

test -f src/server/dispatch-orchestrator.ts \
  || { echo "FAIL: T006 — file not found: src/server/dispatch-orchestrator.ts" >&2; exit 1; }

grep -q "DispatchOrchestrator" src/server/dispatch-orchestrator.ts \
  || { echo "FAIL: T006 — src/server/dispatch-orchestrator.ts missing 'DispatchOrchestrator' class (FR-001)" >&2; exit 1; }

grep -q "dispatch\(Phase\|Tasks\|ToAgent\)" src/server/dispatch-orchestrator.ts \
  || { echo "FAIL: T006 — src/server/dispatch-orchestrator.ts missing dispatch method (e.g. dispatchPhase, dispatchTasks) (FR-003). hint: implement an async method that dispatches tasks in parallel." >&2; exit 1; }

grep -q "maxClones\|maxConcurrent\|concurren" src/server/dispatch-orchestrator.ts \
  || { echo "FAIL: T006 — src/server/dispatch-orchestrator.ts missing concurrency limit logic (FR-004)" >&2; exit 1; }

echo "PASS: T006 — Implement src/server/dispatch-orchestrator.ts"

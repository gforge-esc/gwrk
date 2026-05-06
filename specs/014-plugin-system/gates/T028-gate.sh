#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/define-orchestrator.ts \
  || { echo "FAIL: T028 — file not found: src/engine/define-orchestrator.ts" >&2; exit 1; }

grep -q 'DefineOrchestrator' src/engine/define-orchestrator.ts \
  || { echo "FAIL: T028 — define-orchestrator.ts missing DefineOrchestrator class" >&2; exit 1; }

grep -q 'runLoop\|run' src/engine/define-orchestrator.ts \
  || { echo "FAIL: T028 — define-orchestrator.ts missing runLoop method" >&2; exit 1; }

echo "PASS: T028 — Implement src/engine/define-orchestrator.ts"

#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T008: Integrate DispatchOrchestrator into dispatch.ts
# FR-003: dispatch.ts uses DispatchOrchestrator for parallel execution

test -f src/server/dispatch.ts \
  || { echo "FAIL: T008 — file not found: src/server/dispatch.ts" >&2; exit 1; }

grep -q "DispatchOrchestrator" src/server/dispatch.ts \
  || { echo "FAIL: T008 — src/server/dispatch.ts missing 'DispatchOrchestrator' integration (FR-003)" >&2; exit 1; }

echo "PASS: T008 — Integrate DispatchOrchestrator into src/server/dispatch.ts"

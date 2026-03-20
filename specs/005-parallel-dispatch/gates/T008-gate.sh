#!/bin/bash
set -euo pipefail
# AUTHORED
# FR-003: Integrate DispatchOrchestrator
test -f src/server/dispatch.ts
grep -q "DispatchOrchestrator" src/server/dispatch.ts
echo "PASS: T008 — Implement src/server/dispatch.ts"

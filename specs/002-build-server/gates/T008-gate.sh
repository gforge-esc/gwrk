#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/engine/ship-orchestrator.ts || { echo "FAIL: T008 — file not found: src/engine/ship-orchestrator.ts" >&2; exit 1; }
grep -q 'ship:start' src/engine/ship-orchestrator.ts || { echo "FAIL: T008 — src/engine/ship-orchestrator.ts missing 'ship:start' event" >&2; exit 1; }
grep -q 'ship:complete' src/engine/ship-orchestrator.ts || { echo "FAIL: T008 — src/engine/ship-orchestrator.ts missing 'ship:complete' event" >&2; exit 1; }
echo "PASS: T008 — Implement src/engine/ship-orchestrator.ts"

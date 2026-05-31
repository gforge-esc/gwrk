#!/bin/bash
set -euo pipefail
# GENERATED
test -f src/engine/define-orchestrator.test.ts || { echo "FAIL: T035 — file not found: src/engine/define-orchestrator.test.ts" >&2; exit 1; }
pnpm vitest run src/engine/define-orchestrator.test.ts --reporter=verbose || { echo "FAIL: T035 — vitest failed for src/engine/define-orchestrator.test.ts" >&2; exit 1; }
echo "PASS: T035 — Implement src/engine/define-orchestrator.test.ts"
#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/engine/ship-orchestrator.ts

grep -q "plan:ship:complete" src/engine/ship-orchestrator.ts
pnpm vitest run src/engine/ship-orchestrator.test.ts

echo "PASS: T014 — Ship lifecycle hook wired"

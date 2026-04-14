#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/engine/define-orchestrator.ts

grep -q "plan:define:complete" src/engine/define-orchestrator.ts
pnpm vitest run src/engine/define-orchestrator.test.ts

echo "PASS: T015 — Define lifecycle hook wired"

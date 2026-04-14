#!/bin/bash
set -euo pipefail
# Gate: T003 — Implement src/engine/plan-store.ts

test -f src/engine/plan-store.ts
pnpm vitest run src/engine/plan-store.test.ts

echo "PASS: T003 — PlanStore business logic implemented"

#!/bin/bash
set -euo pipefail
# Gate: T009 — Implement src/engine/plan-solver.ts

test -f src/engine/plan-solver.ts
pnpm vitest run src/engine/plan-solver.test.ts

echo "PASS: T009 — Solver engine implemented"

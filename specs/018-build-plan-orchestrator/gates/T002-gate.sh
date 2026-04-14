#!/bin/bash
set -euo pipefail
# Gate: T002 — Implement src/db/plan.ts

test -f src/db/plan.ts
pnpm vitest run src/db/plan.test.ts

echo "PASS: T002 — Low-level DB access implemented"

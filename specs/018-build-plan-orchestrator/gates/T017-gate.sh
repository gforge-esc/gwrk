#!/bin/bash
set -euo pipefail
# Gate: T017 — Implement src/utils/state.ts

grep -q "sp_actual" src/utils/state.ts
pnpm vitest run src/utils/state.test.ts

echo "PASS: T017 — Invariant checks implemented"

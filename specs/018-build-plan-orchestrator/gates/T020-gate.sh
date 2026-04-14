#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement src/engine/plan-renderer.ts

test -f src/engine/plan-renderer.ts
pnpm vitest run src/engine/plan-renderer.test.ts

echo "PASS: T020 — Markdown renderer implemented"

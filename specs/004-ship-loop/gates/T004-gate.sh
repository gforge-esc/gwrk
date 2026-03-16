#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/commands/ship.test.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
pnpm vitest run src/commands/ship.test.ts

echo "PASS: T004 — Implement src/commands/ship.test.ts"

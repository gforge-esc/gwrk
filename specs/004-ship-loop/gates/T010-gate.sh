#!/bin/bash
set -euo pipefail
# Gate: T010 — Implement src/scripts-e2e.test.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
pnpm vitest run src/scripts-e2e.test.ts

echo "PASS: T010 — Implement src/scripts-e2e.test.ts"

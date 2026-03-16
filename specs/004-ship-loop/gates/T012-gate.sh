#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement src/commands/ship.test.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Test file — run it
pnpm vitest run src/commands/ship.test.ts --reporter=verbose

echo "PASS: T012 — Implement src/commands/ship.test.ts"

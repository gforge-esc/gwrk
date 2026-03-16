#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement src/scripts-e2e.test.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Test file — run it
pnpm vitest run src/scripts-e2e.test.ts --reporter=verbose

echo "PASS: T013 — Implement src/scripts-e2e.test.ts"

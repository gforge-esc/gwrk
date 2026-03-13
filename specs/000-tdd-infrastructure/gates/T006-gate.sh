#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement src/commands/ship.test.ts
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.

# Done When (from plan)
pnpm vitest run src/utils/gate-gen.test.ts src/commands/tasks-generate.test.ts src/commands/tasks-done.test.ts src/commands/ship.test.ts src/commands/test-cmd.test.ts src/commands/server.test.ts

echo "PASS: T006 — Implement src/commands/ship.test.ts"

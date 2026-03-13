#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement test strategy for Phase 1
# Generated: assertions derived from plan Done When + file type.
# To override, add '# AUTHORED' anywhere and edit freely.


# Phase Acceptance Criteria (Done When)
pnpm vitest run src/utils/gate-gen.test.ts src/commands/tasks-generate.test.ts src/commands/tasks-done.test.ts src/commands/ship.test.ts src/commands/test-cmd.test.ts src/commands/server.test.ts
pnpm build

echo "PASS: T008 — Implement test strategy for Phase 1"

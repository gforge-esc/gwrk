#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T008 — Implement test strategy for Phase 1
pnpm vitest run \
  src/utils/gate-gen.test.ts \
  src/commands/tasks-generate.test.ts \
  src/commands/tasks-done.test.ts \
  src/commands/ship.test.ts \
  src/commands/test-cmd.test.ts \
  src/commands/server.test.ts \
  --reporter=verbose
echo "PASS: T008 — Implement test strategy for Phase 1"

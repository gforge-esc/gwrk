#!/bin/bash
set -euo pipefail
# AUTHORED
# TR-002: Verify worktree creation/removal
test -f src/server/sandbox.test.ts
pnpm vitest run src/server/sandbox.test.ts --reporter=verbose
echo "PASS: T002 — Implement src/server/sandbox.test.ts"

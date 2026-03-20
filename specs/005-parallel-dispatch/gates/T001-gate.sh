#!/bin/bash
set -euo pipefail
# AUTHORED
# FR-002: Replace Dockerode with git worktree logic
test -f src/server/sandbox.ts
grep -q "git worktree add" src/server/sandbox.ts
grep -q ".runs/sandboxes/" src/server/sandbox.ts
! grep -q "import Docker from \"dockerode\"" src/server/sandbox.ts
echo "PASS: T001 — Implement src/server/sandbox.ts"

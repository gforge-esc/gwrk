#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T004: Modify src/server/dispatch.ts
# FR-002: Update DispatchQueue to use SandboxManager (worktree workDir)

test -f src/server/dispatch.ts \
  || { echo "FAIL: T004 — file not found: src/server/dispatch.ts" >&2; exit 1; }

grep -q "workDir" src/server/dispatch.ts \
  || { echo "FAIL: T004 — src/server/dispatch.ts missing 'workDir' references (FR-002)" >&2; exit 1; }

! grep -q "containerId" src/server/dispatch.ts \
  || { echo "FAIL: T004 — src/server/dispatch.ts still references 'containerId'. Must use 'workDir'." >&2; exit 1; }

echo "PASS: T004 — Modify src/server/dispatch.ts"

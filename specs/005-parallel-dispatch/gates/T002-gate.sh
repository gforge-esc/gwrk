#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T002: Verify src/server/sandbox.test.ts
# TR-002: Verify worktree creation/removal tests

test -f src/server/sandbox.test.ts \
  || { echo "FAIL: T002 — file not found: src/server/sandbox.test.ts" >&2; exit 1; }

pnpm vitest run src/server/sandbox.test.ts --reporter=verbose \
  || { echo "FAIL: T002 — vitest failed for src/server/sandbox.test.ts" >&2; exit 1; }

echo "PASS: T002 — Verify src/server/sandbox.test.ts"

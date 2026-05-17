#!/bin/bash
# AUTHORED
set -euo pipefail

# Task T001: Rewrite src/server/sandbox.ts (Docker to Worktree)
# Contract: contracts/sandbox.md

test -f src/server/sandbox.ts \
  || { echo "FAIL: T001 — file not found: src/server/sandbox.ts" >&2; exit 1; }

grep -q "git worktree add" src/server/sandbox.ts \
  || { echo "FAIL: T001 — src/server/sandbox.ts missing 'git worktree add' (FR-002: worktree creation)" >&2; exit 1; }

grep -q ".runs/sandboxes/" src/server/sandbox.ts \
  || { echo "FAIL: T001 — src/server/sandbox.ts missing '.runs/sandboxes/' path convention (FR-002)" >&2; exit 1; }

! grep -q 'import Docker from "dockerode"' src/server/sandbox.ts \
  || { echo "FAIL: T001 — src/server/sandbox.ts still imports Dockerode. Must be fully replaced with git worktree." >&2; exit 1; }

! grep -q 'dockerode' src/server/sandbox.ts \
  || { echo "FAIL: T001 — src/server/sandbox.ts still references dockerode. Full rewrite required." >&2; exit 1; }

echo "PASS: T001 — Rewrite src/server/sandbox.ts (Docker to Worktree)"

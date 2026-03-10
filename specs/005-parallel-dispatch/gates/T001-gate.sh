#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement src/server/git-manager.ts
# Asserts: Derived from task description

test -f src/server/git-manager.ts
grep -q 'createWorktree' src/server/git-manager.ts

echo "PASS: T001 — Implement src/server/git-manager.ts"

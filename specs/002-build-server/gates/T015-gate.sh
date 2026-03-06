#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement src/server/git-manager.ts
# Asserts: Derived from task description

test -f src/server/git-manager.ts
grep -q 'createPhaseBranch' src/server/git-manager.ts

echo "PASS: T015 — Implement src/server/git-manager.ts"

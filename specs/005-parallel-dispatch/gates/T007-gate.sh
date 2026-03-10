#!/bin/bash
set -euo pipefail
# Gate: T007 — Implement src/server/git-manager.ts
# Asserts: Derived from task description

test -f src/server/git-manager.ts
grep -q 'atomicMerge' src/server/git-manager.ts

echo "PASS: T007 — Implement src/server/git-manager.ts"

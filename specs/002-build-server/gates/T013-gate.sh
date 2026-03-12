#!/bin/bash
set -euo pipefail
# Gate: T013 — Implement src/server/git-manager.ts
# Asserts: Derived from task description

test -f src/server/git-manager.ts
# Required identifiers
grep -q 'createPhaseBranch' src/server/git-manager.ts
grep -q 'mergePhaseBack' src/server/git-manager.ts

echo "PASS: T013 — Implement src/server/git-manager.ts"

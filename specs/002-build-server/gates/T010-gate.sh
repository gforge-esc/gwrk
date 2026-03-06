#!/usr/bin/env bash
# Gate: T010 — Implement Git Manager for phase branches
set -euo pipefail

# Assertion #1: src/server/git-manager.ts exists
test -f src/server/git-manager.ts || { echo "FAIL: src/server/git-manager.ts not found"; exit 1; }

# Assertion #2: createPhaseBranch exported
grep -q "export.*createPhaseBranch" src/server/git-manager.ts || { echo "FAIL: createPhaseBranch not exported"; exit 1; }

# Assertion #3: mergePhaseBack exported
grep -q "export.*mergePhaseBack" src/server/git-manager.ts || { echo "FAIL: mergePhaseBack not exported"; exit 1; }

# Assertion #4: isClean exported
grep -q "export.*isClean" src/server/git-manager.ts || { echo "FAIL: isClean not exported"; exit 1; }

# Assertion #5: hasConflicts exported
grep -q "export.*hasConflicts" src/server/git-manager.ts || { echo "FAIL: hasConflicts not exported"; exit 1; }

# Assertion #6: uses git checkout -b
grep -q "git checkout -b" src/server/git-manager.ts || { echo "FAIL: branch creation via checkout -b missing"; exit 1; }

echo "PASS: T010"

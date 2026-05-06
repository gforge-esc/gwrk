#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T008 — Implement scripts/dev/wud-branch.sh

FILE="scripts/dev/wud-branch.sh"

# Assertion 1: File exists and is executable
test -f "$FILE"
test -x "$FILE"

# Assertion 2: git status --porcelain check exists
grep -q "git status --porcelain" "$FILE"

# Assertion 3: Dirty tree message and exit 1
grep -q "Dirty working tree — commit or stash before shipping" "$FILE"
grep -q "exit 1" "$FILE"

echo "PASS: T008 — scripts/dev/wud-branch.sh dirty-tree guard verified"

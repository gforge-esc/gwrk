#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T016 — Implement specs/004-ship-loop/contracts/branch.md

FILE="specs/004-ship-loop/contracts/branch.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: dirty-tree guard is documented
grep -i -q "dirty-tree" "$FILE"
grep -q "fail-fast" "$FILE"

echo "PASS: T016 — specs/004-ship-loop/contracts/branch.md updated"

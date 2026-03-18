#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T019 — Implement specs/004-ship-loop/contracts/pr.md

FILE="specs/004-ship-loop/contracts/pr.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: PR creation and CI wait documented
grep -q "gh pr create" "$FILE"
grep -q "waiting for CI" "$FILE"

echo "PASS: T019 — specs/004-ship-loop/contracts/pr.md exists and updated"

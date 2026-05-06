#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Implement specs/004-ship-loop/.gwrk/runs/.gitkeep

FILE="specs/004-ship-loop/.gwrk/runs/.gitkeep"

# Assertion 1: Directory exists
test -d "specs/004-ship-loop/.gwrk/runs"

# Assertion 2: .gitkeep file exists
test -f "$FILE"

echo "PASS: T005 — specs/004-ship-loop/.gwrk/runs/.gitkeep exists"

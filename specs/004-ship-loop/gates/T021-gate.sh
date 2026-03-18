#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T021 — Implement specs/004-ship-loop/checklists/requirements.md

FILE="specs/004-ship-loop/checklists/requirements.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Checklist against new FRs
grep -q "FR-018" "$FILE"

echo "PASS: T021 — specs/004-ship-loop/checklists/requirements.md updated"

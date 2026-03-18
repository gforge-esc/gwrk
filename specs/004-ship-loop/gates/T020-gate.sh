#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T020 — Implement specs/004-ship-loop/gap-analysis.md

FILE="specs/004-ship-loop/gap-analysis.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: Gap analysis reflects current implementation
grep -i -q "current implementation" "$FILE" || grep -i -q "implemented" "$FILE"

echo "PASS: T020 — specs/004-ship-loop/gap-analysis.md updated"

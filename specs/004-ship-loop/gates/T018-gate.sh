#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T018 — Implement specs/004-ship-loop/contracts/verdict.md

FILE="specs/004-ship-loop/contracts/verdict.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: GO/NO-GO format is documented
grep -i -q "GO/NO-GO" "$FILE"

echo "PASS: T018 — specs/004-ship-loop/contracts/verdict.md updated"

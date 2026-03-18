#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T017 — Implement specs/004-ship-loop/contracts/wud.md

FILE="specs/004-ship-loop/contracts/wud.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: CIRCUIT_BREAK is documented
grep -q "CIRCUIT_BREAK" "$FILE"

# Assertion 3: failureContext is documented
grep -q "failureContext" "$FILE"

echo "PASS: T017 — specs/004-ship-loop/contracts/wud.md updated"

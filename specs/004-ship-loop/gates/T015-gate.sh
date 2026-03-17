#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T015 — Implement specs/004-ship-loop/contracts/implement.md

FILE="specs/004-ship-loop/contracts/implement.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: emit_event() is documented
grep -q "emit_event(" "$FILE"

# Assertion 3: validate-staging.sh is documented as robust and complete
grep -q "validate-staging.sh" "$FILE"
grep -q "robust and complete" "$FILE"

echo "PASS: T015 — specs/004-ship-loop/contracts/implement.md updated"

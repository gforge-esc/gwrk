#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T014 — Implement specs/004-ship-loop/contracts/ship.md

FILE="specs/004-ship-loop/contracts/ship.md"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: isPhaseComplete() is documented
grep -q "isPhaseComplete(" "$FILE"

# Assertion 3: assembleDigest() is documented
grep -q "assembleDigest(" "$FILE"

# Assertion 4: Manifest schema with digest[] is documented
grep -q "digest: z.array(z.string())" "$FILE"

echo "PASS: T014 — specs/004-ship-loop/contracts/ship.md updated"

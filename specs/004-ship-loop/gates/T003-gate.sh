#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Implement src/commands/ship.ts

FILE="src/commands/ship.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: isPhaseComplete function exists and uses cancelled
grep -q "function isPhaseComplete(" "$FILE"
grep -q "\"cancelled\"" "$FILE"

# Assertion 3: phase-skip logic is used in the command action
grep -q "if (isPhaseComplete(phaseData)) {" "$FILE"
grep -q "Phase .*: all tasks complete — skipping" "$FILE"

# Assertion 4: assembleDigest is imported and used in writeManifest call
grep -q "import { assembleDigest, .* } from \"../utils/manifest.js\"" "$FILE"
grep -q "digest: assembleDigest(" "$FILE"

echo "PASS: T003 — src/commands/ship.ts implementation verified"

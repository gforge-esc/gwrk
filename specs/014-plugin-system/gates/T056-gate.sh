#!/bin/bash
# AUTHORED
set -euo pipefail

# T056: Implement src/utils/agent.ts (call resolveEnforcementSkills)
FILE="src/utils/agent.ts"

test -f "$FILE" \
  || { echo "FAIL: T056 — file not found: $FILE" >&2; exit 1; }

grep -q "resolveEnforcementSkills" "$FILE" \
  || { echo "FAIL: T056 — $FILE missing 'resolveEnforcementSkills' call" >&2; exit 1; }

echo "PASS: T056 — src/utils/agent.ts calls resolveEnforcementSkills"
#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T025 — Implement src/commands/ship.ts: replace direct agent-run.sh invocation with dispatchToAgent

FILE="src/commands/ship.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: ship.ts imports dispatchAgent (or dispatchToAgent)
grep -qE "import { .*,? ?dispatch(To)?Agent ?,? ?.* } from \"../utils/agent.js\"" "$FILE"

# Assertion 3: ship.ts calls dispatchAgent
grep -qE "dispatch(To)?Agent\(" "$FILE"

echo "PASS: T025 — src/commands/ship.ts implementation verified"

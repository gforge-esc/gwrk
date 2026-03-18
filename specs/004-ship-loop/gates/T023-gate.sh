#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T023 — Implement src/utils/agent.ts: extract dispatchToAgent

FILE="src/utils/agent.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: dispatchAgent (or dispatchToAgent) is exported
grep -qE "export (async )?function dispatch(To)?Agent" "$FILE"

# Assertion 3: buildCommand is exported
grep -q "export function buildCommand" "$FILE"

echo "PASS: T023 — src/utils/agent.ts implementation verified"

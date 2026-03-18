#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T024 — Implement src/utils/agent.test.ts: unit tests for dispatchToAgent

FILE="src/utils/agent.test.ts"

# Assertion 1: File exists
test -f "$FILE"

# Assertion 2: vitest runs and passes
pnpm vitest run "$FILE" --reporter=verbose

# Assertion 3: dispatchAgent (or dispatchToAgent) is imported
grep -qE "import { .*,? ?dispatch(To)?Agent ?,? ?.* } from \"./agent.js\"" "$FILE"

echo "PASS: T024 — src/utils/agent.test.ts implementation verified"

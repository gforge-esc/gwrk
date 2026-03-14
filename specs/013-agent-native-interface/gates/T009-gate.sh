#!/bin/bash
set -euo pipefail
# Gate: T009 — Create gwrk project command group
# Source: contracts/discover.md, spec FR-004
# AUTHORED

# Assertion #1: project.ts exists
test -f src/commands/project.ts

# Assertion #2: project command exported
grep -qE 'projectCommand|project' src/commands/project.ts

# Assertion #3: discover subcommand defined
grep -q 'discover' src/commands/project.ts

# Assertion #4: Registered in cli.ts
grep -qE 'projectCommand|project' src/cli.ts

# Assertion #5: Test file exists and passes
test -f src/commands/project.test.ts
pnpm vitest run src/commands/project.test.ts > /dev/null 2>&1 || { echo "FAIL: project.test.ts tests failed"; exit 1; }

# Assertion #6: E2E — gwrk project discover --format json produces valid JSON
RESULT=$(gwrk project discover --format json 2>/dev/null || true)
echo "$RESULT" | jq -e '.project.name' > /dev/null || { echo "FAIL: project discover --format json invalid"; exit 1; }

echo "PASS: T009 — Create gwrk project command group"

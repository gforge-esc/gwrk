#!/bin/bash
set -euo pipefail
# Gate: T006 — Create gwrk gate-check command
# Source: contracts/gate-check.md, DM-002
# AUTHORED

# Assertion #1: gate-check.ts exists
test -f src/commands/gate-check.ts

# Assertion #2: GateCheckResult type or interface
grep -q 'GateCheckResult' src/commands/gate-check.ts

# Assertion #3: Gate script path resolution pattern
grep -q 'gates/' src/commands/gate-check.ts

# Assertion #4: --feature / -f option
grep -q "\-f\|--feature" src/commands/gate-check.ts

# Assertion #5: Registered in cli.ts
grep -q 'gateCheck\|gate-check\|gate_check' src/cli.ts

# Assertion #6: Test file exists and passes
test -f src/commands/gate-check.test.ts
pnpm vitest run src/commands/gate-check.test.ts --reporter=verbose

# Assertion #7: E2E — gate-check with --format json returns JSON with result field
gwrk gate-check T001 -f specs/000-tdd-infrastructure --format json 2>/dev/null | jq -e '.result' > /dev/null || { echo "FAIL: gate-check --format json missing .result"; exit 1; }

echo "PASS: T006 — Create gwrk gate-check command"

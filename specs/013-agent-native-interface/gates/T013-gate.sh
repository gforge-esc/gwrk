#!/bin/bash
set -euo pipefail
# Gate: T013 — Create Layer 2 agent protections
# Source: spec FR-003
# AUTHORED

# Assertion #1: agent-layer.ts exists
test -f src/utils/agent-layer.ts

# Assertion #2: processForAgent exported
grep -qE 'export.*processForAgent|export.*function processForAgent' src/utils/agent-layer.ts

# Assertion #3: stripAnsi function defined
grep -q 'stripAnsi' src/utils/agent-layer.ts

# Assertion #4: guardBinary function defined
grep -q 'guardBinary' src/utils/agent-layer.ts

# Assertion #5: truncateOverflow function defined
grep -q 'truncateOverflow' src/utils/agent-layer.ts

# Assertion #6: 8192 byte threshold present
grep -q '8192' src/utils/agent-layer.ts

# Assertion #7: File reference pattern for overflow
grep -q '/tmp/gwrk-output' src/utils/agent-layer.ts

# Assertion #8: Test file exists and passes
test -f src/utils/agent-layer.test.ts
pnpm vitest run src/utils/agent-layer.test.ts > /dev/null 2>&1 || { echo "FAIL: agent-layer.test.ts tests failed"; exit 1; }

echo "PASS: T013 — Create Layer 2 agent protections"

#!/bin/bash
set -euo pipefail
# Gate: T001 — Create withSignal() HOF
# Source: contracts/signal.md
# AUTHORED

# Assertion #1: signal.ts exists
test -f src/utils/signal.ts

# Assertion #2: withSignal function exported
grep -q 'export.*function withSignal\|export.*withSignal' src/utils/signal.ts

# Assertion #3: Uses performance.now() for timing (contract requirement)
grep -q 'performance.now()' src/utils/signal.ts

# Assertion #4: Sets process.exitCode (NOT process.exit) — testability contract
grep -q 'process.exitCode' src/utils/signal.ts

# Assertion #5: Emits signal format [exit: on stderr
grep -q '\[exit:' src/utils/signal.ts

# Assertion #6: Handles duration formatting (<1s = ms, ≥1s = Ns)
grep -q 'ms\|\..*s' src/utils/signal.ts

# Assertion #7: Test file exists
test -f src/utils/signal.test.ts

# Assertion #8: Tests pass
pnpm vitest run src/utils/signal.test.ts --reporter=verbose

echo "PASS: T001 — Create withSignal() HOF"

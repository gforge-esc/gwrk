#!/usr/bin/env bash
# Gate: T018 — Multi-repo and spec progress tests
set -euo pipefail

# Assertion #1: scanSpecProgress tests in engine
grep -q "scanSpecProgress" "src/engine/pulse.test.ts" || { echo "FAIL #1: scanSpecProgress tests missing in engine"; exit 1; }

# Assertion #2: generatePulseReport tests
grep -q "generatePulseReport" "src/engine/pulse.test.ts" || { echo "FAIL #2: generatePulseReport tests missing"; exit 1; }

# Assertion #3: Render tests in command
grep -q "renderPulseTable\|render.*Table\|format.*Report" "src/commands/pulse.test.ts" || { echo "FAIL #3: renderPulseTable tests missing"; exit 1; }

# Assertion #4: Engine tests pass
npx vitest run src/engine/pulse.test.ts --reporter=verbose 2>&1 || { echo "FAIL #4: engine tests did not pass"; exit 1; }

# Assertion #5: Command tests pass
npx vitest run src/commands/pulse.test.ts --reporter=verbose 2>&1 || { echo "FAIL #5: command tests did not pass"; exit 1; }

echo "PASS: T018"

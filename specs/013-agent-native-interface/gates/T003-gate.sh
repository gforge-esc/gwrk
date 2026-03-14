#!/bin/bash
set -euo pipefail
# Gate: T003 — Create CommandOutput abstraction
# Source: contracts/output.md
# AUTHORED

# Assertion #1: output.ts exists
test -f src/utils/output.ts

# Assertion #2: CommandOutput interface exported
grep -q 'export.*interface CommandOutput\|export.*CommandOutput' src/utils/output.ts

# Assertion #3: createOutput factory exported
grep -q 'export.*function createOutput\|export.*createOutput' src/utils/output.ts

# Assertion #4: write method defined
grep -q 'write(' src/utils/output.ts

# Assertion #5: info method defined (stderr)
grep -q 'info(' src/utils/output.ts

# Assertion #6: Handles both 'human' and 'json' formats
grep -q "'human'" src/utils/output.ts
grep -q "'json'" src/utils/output.ts

# Assertion #7: Test file exists and passes
test -f src/utils/output.test.ts
pnpm vitest run src/utils/output.test.ts --reporter=verbose

echo "PASS: T003 — Create CommandOutput abstraction"

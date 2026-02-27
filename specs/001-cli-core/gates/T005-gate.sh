#!/bin/bash
set -euo pipefail
# Gate: T005 — Shell execution wrapper in src/utils/exec.ts

test -f src/utils/exec.ts
grep -q 'runGate' src/utils/exec.ts
grep -q 'execFileSync\|execFile\|spawnSync' src/utils/exec.ts
grep -q 'exitCode' src/utils/exec.ts
grep -q 'stdout' src/utils/exec.ts
grep -q 'stderr' src/utils/exec.ts

echo "PASS: T005 — exec.ts has runGate with exitCode/stdout/stderr"

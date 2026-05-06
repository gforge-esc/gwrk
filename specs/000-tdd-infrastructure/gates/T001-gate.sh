#!/bin/bash
# AUTHORED
set -euo pipefail
# Gate: T001 — Implement src/utils/gate-gen.ts
test -f src/utils/gate-gen.ts
grep -q "generateGateBrief" src/utils/gate-gen.ts
grep -q "GateBrief" src/utils/gate-gen.ts
grep -q "TaskBrief" src/utils/gate-gen.ts
grep -q "generateRunner" src/utils/gate-gen.ts
pnpm vitest run src/utils/gate-gen.test.ts --reporter=verbose
echo "PASS: T001 — Implement src/utils/gate-gen.ts"

#!/bin/bash
set -euo pipefail
# Gate: T022 — Integration tests for full lifecycle (VR-001, VR-002, VR-003)

test -f tests/integration/lifecycle.test.ts
test -f tests/integration/config.test.ts
grep -q 'describe\|test\|it(' tests/integration/lifecycle.test.ts
grep -q 'describe\|test\|it(' tests/integration/config.test.ts
grep -q 'init\|scaffold' tests/integration/lifecycle.test.ts
grep -q 'generate\|tasks' tests/integration/lifecycle.test.ts
grep -q 'done\|gate' tests/integration/lifecycle.test.ts
grep -q 'history' tests/integration/lifecycle.test.ts
# Integration tests must pass
pnpm test --run tests/integration/lifecycle.test.ts tests/integration/config.test.ts

echo "PASS: T022 — integration tests exist and pass"

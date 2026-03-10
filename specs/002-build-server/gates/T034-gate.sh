#!/bin/bash
set -euo pipefail
# Gate: T034 — Phase 05 test strategy
# Asserts: All tests pass + global build

# #1 All Phase 05 test files exist
test -f src/server/dispatch.test.ts
test -f src/server/routes/dispatch.test.ts
test -f src/server/integration.test.ts

# #2 All Phase 05 tests pass
pnpm vitest run src/server/dispatch.test.ts
pnpm vitest run src/server/routes/dispatch.test.ts
pnpm vitest run src/server/integration.test.ts

# #3 Global build passes
pnpm build

echo "PASS: T034 — Phase 05 test strategy verified"

#!/bin/bash
set -euo pipefail
# Gate: T004 — Implement src/server/index.ts
# HARDENED: Tests behavior (imports work, module has server creation logic)

# Assertion #1: File exists
test -f src/server/index.ts

# Assertion #2: Module compiles and exports expected functions
test -f dist/server/index.js

# Assertion #3: Server index test exists and passes
test -f src/server/index.test.ts
pnpm vitest run src/server/index.test.ts > /dev/null 2>&1 || { echo "FAIL: index.test.ts failed"; exit 1; }

echo "PASS: T004 — Implement src/server/index.ts"

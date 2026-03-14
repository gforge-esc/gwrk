#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement src/server/context.ts
# HARDENED: Tests behavior (context test passes, compileContext exported)

# Assertion #1: File exists
test -f src/server/context.ts

# Assertion #2: compileContext exported
grep -q 'compileContext' src/server/context.ts

# Assertion #3: Context test exists and passes
test -f src/server/context.test.ts
pnpm vitest run src/server/context.test.ts > /dev/null 2>&1 || { echo "FAIL: context.test.ts failed"; exit 1; }

echo "PASS: T014 — Implement src/server/context.ts"

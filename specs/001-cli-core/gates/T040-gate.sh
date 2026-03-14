#!/bin/bash
set -euo pipefail
# Gate: T040 — Implement src/commands/define.ts
# HARDENED: Tests that define command exists and is callable

# Assertion #1: File exists
test -f src/commands/define.ts

# Assertion #2: Define test exists and passes
test -f src/commands/define.test.ts
pnpm vitest run src/commands/define.test.ts > /dev/null 2>&1 || { echo "FAIL: define.test.ts failed"; exit 1; }

echo "PASS: T040 — Implement src/commands/define.ts"

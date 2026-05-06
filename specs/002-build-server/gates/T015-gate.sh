#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement test strategy for Phase 3
# HARDENED: Tests behavior (Phase 3 test files exist and pass)

# Assertion #1: git-manager tests exist and pass
test -f src/server/git-manager.test.ts
pnpm vitest run src/server/git-manager.test.ts > /dev/null 2>&1 || { echo "FAIL: git-manager.test.ts failed"; exit 1; }

# Assertion #2: context tests exist and pass
test -f src/server/context.test.ts
pnpm vitest run src/server/context.test.ts > /dev/null 2>&1 || { echo "FAIL: context.test.ts failed"; exit 1; }

# Assertion #3: sandbox tests exist and pass
test -f src/server/sandbox.test.ts
pnpm vitest run src/server/sandbox.test.ts > /dev/null 2>&1 || { echo "FAIL: sandbox.test.ts failed"; exit 1; }

echo "PASS: T015 — Implement test strategy for Phase 3"

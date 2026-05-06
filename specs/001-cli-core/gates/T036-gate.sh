#!/bin/bash
set -euo pipefail
# Gate: T036 — Implement src/cli.e2e.test.ts
# HARDENED: Runs the actual e2e test (not full test suite)

# Assertion #1: E2E test file exists
test -f src/cli.e2e.test.ts

# Assertion #2: E2E tests pass
pnpm vitest run src/cli.e2e.test.ts > /dev/null 2>&1 || { echo "FAIL: cli.e2e.test.ts failed"; exit 1; }

echo "PASS: T036 — Implement src/cli.e2e.test.ts"

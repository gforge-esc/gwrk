#!/bin/bash
set -euo pipefail
# Gate: T012 — Implement test strategy for Phase 3
# AUTHORED — vitest exit code is the assertion, not brittle grep

# 1. Server tests pass (vitest exits 0 on success, non-zero on failure)
pnpm vitest run src/server/

# 2. Slack gate uses vitest (not bare test -f)
grep -q "pnpm vitest run" specs/003-slack/gates/T007-gate.sh

# 3. Full test suite passes
pnpm vitest run

# 4. Build clean
pnpm build

echo "PASS: T012 — Implement test strategy for Phase 3"

#!/bin/bash
set -euo pipefail
# Gate: T043 — Implement test strategy for Phase 6
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/lifecycle.test.ts
pnpm vitest run src/server/network.test.ts
pnpm vitest run src/server/routes/health.test.ts
test -f src/server/lifecycle.ts && test -f src/server/network.ts && test -f src/server/routes/health.ts

echo "PASS: T043 — Implement test strategy for Phase 6"

#!/bin/bash
set -euo pipefail
# Gate: T014 — Implement test strategy for Phase 2
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/monitor.test.ts
pnpm vitest run src/server/routes/status.test.ts
test -f src/server/monitor.ts && test -f src/server/routes/status.ts && test -f src/commands/status.ts

echo "PASS: T014 — Implement test strategy for Phase 2"

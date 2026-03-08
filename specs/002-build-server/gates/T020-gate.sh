#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement test strategy for Phase 3
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/git-manager.test.ts
pnpm vitest run src/server/context.test.ts
test -f src/server/git-manager.ts && test -f src/server/context.ts && test -f src/server/types.ts

echo "PASS: T020 — Implement test strategy for Phase 3"

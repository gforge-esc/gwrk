#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement test strategy for Phase 8
# Asserts: Derived from task description


# Phase Acceptance Criteria
/gwrk approve test-feature phase-01
gh pr merge 5
/gwrk approve test-feature phase-01
No open PR found...
/gwrk ship 002-build-server 3
pnpm vitest run src/server/slack-actions.test.ts
pnpm vitest run src/server/slack-commands.test.ts
pnpm build

echo "PASS: T020 — Implement test strategy for Phase 8"

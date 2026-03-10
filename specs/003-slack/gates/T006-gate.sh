#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement test strategy for Phase 1
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/commands/setup-slack.test.ts
pnpm vitest run src/server/slack.test.ts
pnpm build
node dist/cli.js setup slack --help

echo "PASS: T006 — Implement test strategy for Phase 1"

#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement test strategy for Phase 6
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/slack-home.test.ts
pnpm build

echo "PASS: T006 — Implement test strategy for Phase 6"

#!/bin/bash
set -euo pipefail
# Gate: T020 — Implement test strategy for Phase 4
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/backend-selector.integration.test.ts
grep -q "BackendSelector\|selectBackend\|backend-selector" src/commands/ship.ts
pnpm build

echo "PASS: T020 — Implement test strategy for Phase 4"

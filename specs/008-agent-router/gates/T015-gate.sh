#!/bin/bash
set -euo pipefail
# Gate: T015 — Implement test strategy for Phase 3
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/backend-selector.test.ts src/server/routing-decisions.test.ts
grep -q "selectBackend" src/server/backend-selector.ts
grep -q "routing_decisions" src/db/migrations/003-routing-decisions.sql
grep -q "fallback" src/server/backend-selector.ts

echo "PASS: T015 — Implement test strategy for Phase 3"

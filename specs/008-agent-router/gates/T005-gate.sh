#!/bin/bash
set -euo pipefail
# Gate: T005 — Implement test strategy for Phase 1
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/server/agent-registry.test.ts
grep -q "loadRegistry" src/server/agent-registry.ts
grep -q "agents.*registry" src/utils/config.ts

echo "PASS: T005 — Implement test strategy for Phase 1"

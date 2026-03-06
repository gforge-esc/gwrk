#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement test strategy for Phase 1
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/commands/server.test.ts
pnpm vitest run src/server/index.test.ts
test -f src/server/index.ts && test -f src/server/pid.ts && test -f src/commands/server.ts
grep -q '"fastify"' package.json

echo "PASS: T008 — Implement test strategy for Phase 1"

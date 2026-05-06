#!/bin/bash
set -euo pipefail
# Gate: T008 — Implement test strategy for Phase 1
# Asserts: Derived from task description


# Phase Acceptance Criteria
pnpm vitest run src/engine/effort.test.ts
pnpm vitest run src/engine/spec-parser.test.ts
test -f src/engine/effort.ts
test -f src/engine/spec-parser.ts
test -f src/engine/roles.ts
test -f src/engine/report-writer.ts
test -f src/engine/types.ts

echo "PASS: T008 — Implement test strategy for Phase 1"

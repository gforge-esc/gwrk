#!/bin/bash
set -euo pipefail
# Gate: T006 — Implement test strategy for Phase 1
# Asserts: Derived from task description


# Phase Acceptance Criteria
npx vitest run src/commands/implement.test.ts
npx tsc --noEmit
grep -r 'loadTaskState\|nextTask\|runGate\|markTaskComplete' src/commands/implement.ts | wc -l

echo "PASS: T006 — Implement test strategy for Phase 1"

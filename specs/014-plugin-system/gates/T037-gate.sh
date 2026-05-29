#!/bin/bash
set -euo pipefail
# GENERATED
# This task verifies the full test suite for Phase 6
pnpm vitest run src/engine/define-orchestrator.test.ts --reporter=verbose || { echo "FAIL: T037 — Phase 6 orchestrator tests failed" >&2; exit 1; }
pnpm vitest run src/commands/specify.test.ts --reporter=verbose || { echo "FAIL: T037 — Phase 6 specify tests failed" >&2; exit 1; }
pnpm vitest run src/commands/define-plan.test.ts --reporter=verbose || { echo "FAIL: T037 — Phase 6 define-plan tests failed" >&2; exit 1; }
echo "PASS: T037 — Implement test strategy for Phase 6"
#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-008 — merge_pr action merged PR via gh CLI
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-008 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/slack-actions.test.ts --grep "FR-007" --reporter=verbose

echo "PASS: T002-008 — vitest verification complete"

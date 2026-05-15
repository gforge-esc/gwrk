#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-010 — Home tab shows plan DAG status
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-010 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/slack-home.test.ts --grep "US-005" --reporter=verbose

echo "PASS: T002-010 — vitest verification complete"

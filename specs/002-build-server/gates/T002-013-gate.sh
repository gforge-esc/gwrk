#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-013 — Approve Spec button advances pipeline
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-013 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/slack-actions.test.ts --grep "US-004|US-004" --reporter=verbose

echo "PASS: T002-013 — vitest verification complete"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-005 — Messages must have exactly one primary CTA
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-005 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/ship-bridge.test.ts --grep "FR-006|US-003" --reporter=verbose

echo "PASS: T002-005 — vitest verification complete"

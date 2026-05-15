#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T002-006 — Ship:failed triggers phaseFail Slack message
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T002-006 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/server/ship-bridge.test.ts --grep "US-003" --reporter=verbose

echo "PASS: T002-006 — vitest verification complete"

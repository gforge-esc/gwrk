#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T073 — define-plan passes quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T073 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/commands/define-plan.test.ts --grep "FR-028" --reporter=verbose

echo "PASS: T073 — vitest verification complete"

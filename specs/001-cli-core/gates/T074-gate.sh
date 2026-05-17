#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T074 — tasks-generate passes quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T074 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/commands/tasks-generate.test.ts -t "FR-028" --reporter=verbose

echo "PASS: T074 — vitest verification complete"

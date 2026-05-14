#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T072 — specify passes quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T072 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/commands/specify.test.ts --grep "FR-028" --reporter=verbose

echo "PASS: T072 — vitest verification complete"

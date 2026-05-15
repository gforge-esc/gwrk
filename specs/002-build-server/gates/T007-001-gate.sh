#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T007-001 — Agent dispatch recorded in SQLite
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T007-001 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/db/runs.test.ts --grep "FR-011" --reporter=verbose

echo "PASS: T007-001 — vitest verification complete"

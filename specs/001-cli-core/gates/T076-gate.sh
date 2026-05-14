#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T076 — Prose-only output + artifacts = success
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T076 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/commands/tests-generate-contract.test.ts -t "FR-029" --reporter=verbose

echo "PASS: T076 — vitest verification complete"

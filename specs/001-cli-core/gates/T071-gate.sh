#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T071 — All define subcommands pass quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T071 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/commands/tests-generate.test.ts -t "FR-028" --reporter=verbose

echo "PASS: T071 — vitest verification complete"

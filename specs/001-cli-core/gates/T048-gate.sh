#!/bin/bash
set -euo pipefail
# Gate: T048 — Delete src/commands/setup.ts and verify CLI surface
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/cli.e2e.test.ts --reporter=verbose \
  || { echo "FAIL: T048 — vitest failed for src/cli.e2e.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# setup.ts should be deleted, so we check for its absence
if [ -f "src/commands/setup.ts" ]; then
  echo "FAIL: T048 — src/commands/setup.ts still exists" >&2
  exit 1
fi

echo "PASS: T048 — tests pass + setup.ts deleted"

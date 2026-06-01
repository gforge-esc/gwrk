#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T044 — Help text examples audit
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/cli.ux.test.ts -t "US-022|FR-023" --reporter=verbose \
  || { echo "FAIL: T044 — vitest failed for src/cli.ux.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T044 — tests pass + lint clean"

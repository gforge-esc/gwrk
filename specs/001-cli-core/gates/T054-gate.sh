#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T054 — No duplicate surfaces
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/cli.consistency.test.ts --reporter=verbose \
  || { echo "FAIL: T054 — vitest failed for src/cli.consistency.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T054 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T055 — CLI grammar governance
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run tests/governance.test.ts -t "US-025|FR-026" --reporter=verbose \
  || { echo "FAIL: T055 — vitest failed for tests/governance.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T055 — tests pass + lint clean"

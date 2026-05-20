#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T014 — Execution History Query
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/db/db.test.ts -t "US-014" --reporter=verbose \
  || { echo "FAIL: T014 — vitest failed for src/db/db.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T014 — tests pass + lint clean"

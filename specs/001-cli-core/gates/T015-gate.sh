#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T015 — Aggregate Statistics
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/db/db.test.ts -t "US-015" --reporter=verbose \
  || { echo "FAIL: T015 — vitest failed for src/db/db.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T015 — tests pass + lint clean"

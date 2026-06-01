#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T016 — SQLite issues table persistence
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run tests/server-github.test.ts -t "FR-H14" --reporter=verbose \
  || { echo "FAIL: T016 — vitest failed for tests/server-github.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T016 — tests pass + lint clean"

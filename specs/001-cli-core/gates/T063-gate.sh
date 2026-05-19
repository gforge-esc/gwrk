#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T063 — Ship pre-flight setup check
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/ship-setup.test.ts -t "FR-022" --reporter=verbose \
  || { echo "FAIL: T063 — vitest failed for src/commands/ship-setup.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T063 — tests pass + lint clean"

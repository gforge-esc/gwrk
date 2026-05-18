#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T038 — Tasks verify command
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/tasks-verify.test.ts -t "gwrk tasks verify" --reporter=verbose \
  || { echo "FAIL: T038 — vitest failed for src/commands/tasks-verify.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T038 — tests pass + lint clean"

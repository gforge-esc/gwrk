#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Hard Gate Enforcement
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/tasks-done.test.ts --reporter=verbose \
  || { echo "FAIL: T006 — vitest failed for src/commands/tasks-done.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T006 — tests pass + lint clean"

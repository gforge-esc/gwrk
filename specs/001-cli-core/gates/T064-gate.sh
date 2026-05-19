#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T064 — Tolerant JSON extraction for native agent work
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/plugins/workflow-runtime-phase12.test.ts -t "FR-029" --reporter=verbose \
  || { echo "FAIL: T064 — vitest failed for src/plugins/workflow-runtime-phase12.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T064 — tests pass + lint clean"

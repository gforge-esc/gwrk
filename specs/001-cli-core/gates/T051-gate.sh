#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T051 — define tests contract fix
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/tests-generate-contract.test.ts -t "FR-027" --reporter=verbose \
  || { echo "FAIL: T051 — vitest failed for src/commands/tests-generate-contract.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T051 — tests pass + lint clean"

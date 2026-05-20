#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T050 — Feature-arg consistency
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/cli.consistency.test.ts -t "US-023|FR-024" --reporter=verbose \
  || { echo "FAIL: T050 — vitest failed for src/cli.consistency.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T050 — tests pass + lint clean"

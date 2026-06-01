#!/bin/bash
set -euo pipefail
# Gate: T043 — Implement tech stack and layout extraction in detectProfile
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/engine/profile-detector.test.ts -t "tech stack and layout extraction" --reporter=verbose \
  || { echo "FAIL: T043 — vitest failed for src/engine/profile-detector.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/engine/profile-detector.ts --no-errors-on-unmatched \
  || { echo "FAIL: T043 — lint errors in src/engine/profile-detector.ts" >&2; exit 1; }

echo "PASS: T043 — tests pass + lint clean"

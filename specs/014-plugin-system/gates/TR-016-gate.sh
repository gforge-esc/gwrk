#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: TR-016 — Filesystem-based toolchain detection
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/engine/profile-detector.test.ts -t "FR-015" --reporter=verbose \
  || { echo "FAIL: TR-016 — vitest failed for src/engine/profile-detector.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/engine/profile-detector.ts --no-errors-on-unmatched \
  || { echo "FAIL: TR-016 — lint errors in src/engine/profile-detector.ts" >&2; exit 1; }

echo "PASS: TR-016 — tests pass + lint clean"

#!/bin/bash
set -euo pipefail
# Gate: T042 — Implement detectProfile core logic and project type detection
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/engine/profile-detector.test.ts -t "detects.*detection" --reporter=verbose \
  || { echo "FAIL: T042 — vitest failed for src/engine/profile-detector.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
pnpm biome check src/engine/profile-detector.ts --no-errors-on-unmatched \
  || { echo "FAIL: T042 — lint errors in src/engine/profile-detector.ts" >&2; exit 1; }

echo "PASS: T042 — tests pass + lint clean"

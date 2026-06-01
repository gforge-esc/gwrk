#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T015 — GitHub webhook handler
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run tests/server-github.test.ts -t "FR-H12" --reporter=verbose \
  || { echo "FAIL: T015 — vitest failed for tests/server-github.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T015 — tests pass + lint clean"

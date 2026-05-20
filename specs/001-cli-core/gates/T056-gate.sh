#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T056 — define subcommands pass quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/tests-generate-contract-phase12.test.ts -t "FR-028" --reporter=verbose \
  || { echo "FAIL: T056 — vitest failed for src/commands/tests-generate-contract-phase12.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T056 — tests pass + lint clean"

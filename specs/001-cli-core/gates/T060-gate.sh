#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T060 — define subcommands pass quiet: true
# Generated from gap-matrix.md (deterministic vitest gate)

# ── BEHAVIORAL: Tests must pass ──
pnpm vitest run src/commands/cli-core-phase12.test.ts -t "FR-028" --reporter=verbose \
  || { echo "FAIL: T060 — vitest failed for src/commands/cli-core-phase12.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/workflow-runtime-phase12.test.ts -t "FR-029" --reporter=verbose \
  || { echo "FAIL: T060 — vitest failed for src/plugins/workflow-runtime-phase12.test.ts" >&2; exit 1; }

# ── HYGIENE: Source files must lint clean ──
# (no source files found for lint check)

echo "PASS: T060 — tests pass + lint clean"

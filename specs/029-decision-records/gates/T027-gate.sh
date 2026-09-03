#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T027 — Modify plan-renderer.ts
# Generated from filesystem convention (deterministic vitest gate)

test -f src/engine/plan-renderer.ts || { echo "FAIL: T027 — file not found: src/engine/plan-renderer.ts" >&2; exit 1; }

pnpm vitest run src/engine/plan-renderer.test.ts --reporter=verbose \
  || { echo "FAIL: T027 — vitest failed for src/engine/plan-renderer.test.ts" >&2; exit 1; }

echo "PASS: T027 — Modify plan-renderer.ts"

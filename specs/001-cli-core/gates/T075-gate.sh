#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T075 — Tolerant JSON extraction in WorkflowRuntime
# Generated from gap-matrix.md (deterministic vitest gate)

# Compile gate — TypeScript MUST build cleanly
pnpm build \
  || { echo "FAIL: T075 — pnpm build failed. Fix TypeScript compilation errors." >&2; exit 1; }

pnpm vitest run src/plugins/workflow-runtime.test.ts --grep "FR-029" --reporter=verbose

echo "PASS: T075 — vitest verification complete"

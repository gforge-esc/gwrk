#!/bin/bash
# AUTHORED
set -euo pipefail

# Phase 4 test strategy: compile + run all P4 tests

pnpm build \
  || { echo "FAIL: T027 — pnpm build failed" >&2; exit 1; }

test -f src/plugins/workflow-runtime.test.ts \
  || { echo "FAIL: T027 — workflow-runtime.test.ts not found" >&2; exit 1; }

test -f src/engine/intent-engine.test.ts \
  || { echo "FAIL: T027 — intent-engine.test.ts not found" >&2; exit 1; }

pnpm vitest run src/plugins/workflow-runtime.test.ts src/engine/intent-engine.test.ts --reporter=verbose \
  || { echo "FAIL: T027 — Phase 4 tests failed" >&2; exit 1; }

echo "PASS: T027 — Phase 4 test strategy complete"

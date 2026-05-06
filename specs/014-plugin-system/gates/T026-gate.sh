#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/engine/intent-engine.test.ts \
  || { echo "FAIL: T026 — file not found: src/engine/intent-engine.test.ts" >&2; exit 1; }

grep -q 'FR-L25-002' src/engine/intent-engine.test.ts \
  || { echo "FAIL: T026 — intent-engine.test.ts missing FR-L25-002 traceability" >&2; exit 1; }

pnpm vitest run src/engine/intent-engine.test.ts --reporter=verbose \
  || { echo "FAIL: T026 — vitest failed for intent-engine.test.ts" >&2; exit 1; }

echo "PASS: T026 — Implement src/engine/intent-engine.test.ts"

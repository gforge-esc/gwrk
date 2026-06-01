#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P10-003: No .agents/ path in skill-runtime.ts
test -f src/plugins/skill-runtime.p10.red.test.ts \
  || { echo "FAIL: TR-P10-003 — test file not found: src/plugins/skill-runtime.p10.red.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/skill-runtime.p10.red.test.ts --reporter=verbose \
  || { echo "FAIL: TR-P10-003 — vitest failed for src/plugins/skill-runtime.p10.red.test.ts" >&2; exit 1; }

echo "PASS: TR-P10-003 — No .agents/ path in skill-runtime.ts"
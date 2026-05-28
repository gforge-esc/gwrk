#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P10-002: Builtin workflow resolution
test -f src/plugins/loader.p10.red.test.ts \
  || { echo "FAIL: TR-P10-002 — test file not found: src/plugins/loader.p10.red.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/loader.p10.red.test.ts --reporter=verbose \
  || { echo "FAIL: TR-P10-002 — vitest failed for src/plugins/loader.p10.red.test.ts" >&2; exit 1; }

echo "PASS: TR-P10-002 — Builtin workflow resolution"
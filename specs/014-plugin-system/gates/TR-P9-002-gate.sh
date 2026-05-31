#!/bin/bash
# AUTHORED
set -euo pipefail

# TR-P9-002: Project-local override takes precedence over builtin
test -f src/plugins/enforcement.p9.red.test.ts \
  || { echo "FAIL: TR-P9-002 — test file not found: src/plugins/enforcement.p9.red.test.ts" >&2; exit 1; }

pnpm vitest run src/plugins/enforcement.p9.red.test.ts -t "TR-P9-002" --reporter=verbose \
  || { echo "FAIL: TR-P9-002 — vitest failed for TR-P9-002" >&2; exit 1; }

echo "PASS: TR-P9-002 — Project-local override takes precedence"

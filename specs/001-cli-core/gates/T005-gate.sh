#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T005 — Implement src/utils/config.ts

test -f src/utils/config.ts \
  || { echo "FAIL: T005 — file not found: src/utils/config.ts" >&2; exit 1; }

grep -q 'GwrkConfigSchema' src/utils/config.ts \
  || { echo "FAIL: T005 — src/utils/config.ts missing 'GwrkConfigSchema'" >&2; exit 1; }

grep -q 'export function loadConfig' src/utils/config.ts \
  || { echo "FAIL: T005 — src/utils/config.ts missing 'loadConfig'" >&2; exit 1; }

echo "PASS: T005 — Implement src/utils/config.ts"

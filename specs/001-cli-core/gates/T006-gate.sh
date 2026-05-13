#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T006 — Implement src/utils/format.ts

test -f src/utils/format.ts \
  || { echo "FAIL: T006 — file not found: src/utils/format.ts" >&2; exit 1; }

grep -q 'export function banner' src/utils/format.ts \
  || { echo "FAIL: T006 — src/utils/format.ts missing 'banner'" >&2; exit 1; }

grep -q 'export function success' src/utils/format.ts \
  || { echo "FAIL: T006 — src/utils/format.ts missing 'success'" >&2; exit 1; }

echo "PASS: T006 — Implement src/utils/format.ts"

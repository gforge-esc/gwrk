#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T024 — Implement src/utils/history.ts

test -f src/utils/history.ts \
  || { echo "FAIL: T024 — file not found: src/utils/history.ts" >&2; exit 1; }

grep -q 'HistoryEntrySchema' src/utils/history.ts \
  || { echo "FAIL: T024 — src/utils/history.ts missing 'HistoryEntrySchema'" >&2; exit 1; }

grep -q 'export function appendHistory' src/utils/history.ts \
  || { echo "FAIL: T024 — src/utils/history.ts missing 'appendHistory'" >&2; exit 1; }

echo "PASS: T024 — Implement src/utils/history.ts"

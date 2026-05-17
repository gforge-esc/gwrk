#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T022 — Implement src/utils/state.ts

test -f src/utils/state.ts \
  || { echo "FAIL: T022 — file not found: src/utils/state.ts" >&2; exit 1; }

grep -q 'TaskStateSchema' src/utils/state.ts \
  || { echo "FAIL: T022 — src/utils/state.ts missing 'TaskStateSchema'" >&2; exit 1; }

grep -q 'export function loadTaskState' src/utils/state.ts \
  || { echo "FAIL: T022 — src/utils/state.ts missing 'loadTaskState'" >&2; exit 1; }

echo "PASS: T022 — Implement src/utils/state.ts"

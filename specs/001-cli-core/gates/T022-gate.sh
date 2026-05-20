#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/state.ts" || { echo "FAIL: T022 — file not found: src/utils/state.ts" >&2; exit 1; }
grep -q "import" "src/utils/state.ts" || grep -q "export" "src/utils/state.ts" || { echo "FAIL: T022 — src/utils/state.ts missing import/export" >&2; exit 1; }

echo "PASS: T022 — Implement src/utils/state.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/exec.ts" || { echo "FAIL: T018 — file not found: src/utils/exec.ts" >&2; exit 1; }
grep -q "import" "src/utils/exec.ts" || grep -q "export" "src/utils/exec.ts" || { echo "FAIL: T018 — src/utils/exec.ts missing import/export" >&2; exit 1; }

echo "PASS: T018 — Implement src/utils/exec.ts"

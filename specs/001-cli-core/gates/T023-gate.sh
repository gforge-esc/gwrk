#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/gate-gen.ts" || { echo "FAIL: T023 — file not found: src/utils/gate-gen.ts" >&2; exit 1; }
grep -q "import" "src/utils/gate-gen.ts" || grep -q "export" "src/utils/gate-gen.ts" || { echo "FAIL: T023 — src/utils/gate-gen.ts missing import/export" >&2; exit 1; }

echo "PASS: T023 — Implement src/utils/gate-gen.ts"

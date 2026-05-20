#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/specify.ts" || { echo "FAIL: T012 — file not found: src/commands/specify.ts" >&2; exit 1; }
grep -q "import" "src/commands/specify.ts" || grep -q "export" "src/commands/specify.ts" || { echo "FAIL: T012 — src/commands/specify.ts missing import/export" >&2; exit 1; }

echo "PASS: T012 — Implement src/commands/specify.ts"

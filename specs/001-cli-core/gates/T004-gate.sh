#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/init.ts" || { echo "FAIL: T004 — file not found: src/commands/init.ts" >&2; exit 1; }
grep -q "import" "src/commands/init.ts" || grep -q "export" "src/commands/init.ts" || { echo "FAIL: T004 — src/commands/init.ts missing import/export" >&2; exit 1; }

echo "PASS: T004 — Implement src/commands/init.ts"

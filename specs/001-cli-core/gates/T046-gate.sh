#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/tasks.ts" || { echo "FAIL: T046 — file not found: src/commands/tasks.ts" >&2; exit 1; }
grep -q "import" "src/commands/tasks.ts" || grep -q "export" "src/commands/tasks.ts" || { echo "FAIL: T046 — src/commands/tasks.ts missing import/export" >&2; exit 1; }

echo "PASS: T046 — Implement src/commands/tasks.ts"

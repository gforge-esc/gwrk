#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/tasks-generate.ts" || { echo "FAIL: T015 — file not found: src/commands/tasks-generate.ts" >&2; exit 1; }
grep -q "import" "src/commands/tasks-generate.ts" || grep -q "export" "src/commands/tasks-generate.ts" || { echo "FAIL: T015 — src/commands/tasks-generate.ts missing import/export" >&2; exit 1; }

echo "PASS: T015 — Implement src/commands/tasks-generate.ts"

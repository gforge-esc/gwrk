#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/implement.ts" || { echo "FAIL: T020 — file not found: src/commands/implement.ts" >&2; exit 1; }
grep -q "import" "src/commands/implement.ts" || grep -q "export" "src/commands/implement.ts" || { echo "FAIL: T020 — src/commands/implement.ts missing import/export" >&2; exit 1; }

echo "PASS: T020 — Implement src/commands/implement.ts"

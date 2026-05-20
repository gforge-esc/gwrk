#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/new.ts" || { echo "FAIL: T033 — file not found: src/commands/new.ts" >&2; exit 1; }
grep -q "import" "src/commands/new.ts" || grep -q "export" "src/commands/new.ts" || { echo "FAIL: T033 — src/commands/new.ts missing import/export" >&2; exit 1; }

echo "PASS: T033 — Implement src/commands/new.ts"

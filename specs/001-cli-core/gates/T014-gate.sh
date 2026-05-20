#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/analyze.ts" || { echo "FAIL: T014 — file not found: src/commands/analyze.ts" >&2; exit 1; }
grep -q "import" "src/commands/analyze.ts" || grep -q "export" "src/commands/analyze.ts" || { echo "FAIL: T014 — src/commands/analyze.ts missing import/export" >&2; exit 1; }

echo "PASS: T014 — Implement src/commands/analyze.ts"

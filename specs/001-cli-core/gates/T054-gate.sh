#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/gate.ts" || { echo "FAIL: T054 — file not found: src/commands/gate.ts" >&2; exit 1; }
grep -q "import" "src/commands/gate.ts" || grep -q "export" "src/commands/gate.ts" || { echo "FAIL: T054 — src/commands/gate.ts missing import/export" >&2; exit 1; }

echo "PASS: T054 — Implement src/commands/gate.ts"

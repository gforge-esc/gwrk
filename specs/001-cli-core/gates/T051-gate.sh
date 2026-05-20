#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/commands/tests-generate.ts" || { echo "FAIL: T051 — file not found: src/commands/tests-generate.ts" >&2; exit 1; }
grep -q "import" "src/commands/tests-generate.ts" || grep -q "export" "src/commands/tests-generate.ts" || { echo "FAIL: T051 — src/commands/tests-generate.ts missing import/export" >&2; exit 1; }

echo "PASS: T051 — Implement src/commands/tests-generate.ts"

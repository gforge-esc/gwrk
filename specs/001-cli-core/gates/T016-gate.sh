#!/bin/bash
set -euo pipefail
# AUTHORED

test -f "src/utils/agent.ts" || { echo "FAIL: T016 — file not found: src/utils/agent.ts" >&2; exit 1; }
grep -q "import" "src/utils/agent.ts" || grep -q "export" "src/utils/agent.ts" || { echo "FAIL: T016 — src/utils/agent.ts missing import/export" >&2; exit 1; }

echo "PASS: T016 — Implement src/utils/agent.ts"

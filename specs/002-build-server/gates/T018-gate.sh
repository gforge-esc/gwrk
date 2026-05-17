#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/define.ts || { echo "FAIL: T018 — file not found: src/commands/define.ts" >&2; exit 1; }
grep -q 'export const defineCommand' src/commands/define.ts || { echo "FAIL: T018 — src/commands/define.ts missing 'defineCommand'" >&2; exit 1; }
echo "PASS: T018 — Implement src/commands/define.ts"

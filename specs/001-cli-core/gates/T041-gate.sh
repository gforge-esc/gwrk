#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/commands/setup.ts || { echo "FAIL: T041 — file not found: src/commands/setup.ts" >&2; exit 1; }
grep -q 'setupCommand' src/commands/setup.ts || { echo "FAIL: T041 — src/commands/setup.ts missing 'setupCommand'" >&2; exit 1; }

echo "PASS: T041 — Implement src/commands/setup.ts"

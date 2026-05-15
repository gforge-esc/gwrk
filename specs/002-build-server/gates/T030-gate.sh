#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/cli.ts || { echo "FAIL: T030 — file not found: src/cli.ts" >&2; exit 1; }
grep -q 'addCommand(serverCommand)' src/cli.ts || { echo "FAIL: T030 — src/cli.ts missing registration of 'server' command" >&2; exit 1; }
echo "PASS: T030 — Implement src/cli.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/status.ts || { echo "FAIL: T034 — file not found: src/commands/status.ts" >&2; exit 1; }
grep -q 'new Command("status")' src/commands/status.ts || { echo "FAIL: T034 — src/commands/status.ts missing 'status' command" >&2; exit 1; }
echo "PASS: T034 — Implement src/commands/status.ts"

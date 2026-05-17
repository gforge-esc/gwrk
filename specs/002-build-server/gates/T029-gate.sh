#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/commands/server.ts || { echo "FAIL: T029 — file not found: src/commands/server.ts" >&2; exit 1; }
grep -q 'new Command("server")' src/commands/server.ts || { echo "FAIL: T029 — src/commands/server.ts missing 'server' command" >&2; exit 1; }
echo "PASS: T029 — Implement src/commands/server.ts"

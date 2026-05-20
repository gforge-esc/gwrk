#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/commands/server.ts || { echo "FAIL: T001 — file not found: src/commands/server.ts" >&2; exit 1; }
grep -q "command(\"start\")" src/commands/server.ts || { echo "FAIL: T001 — src/commands/server.ts missing 'start' command" >&2; exit 1; }
grep -q "command(\"stop\")" src/commands/server.ts || { echo "FAIL: T001 — src/commands/server.ts missing 'stop' command" >&2; exit 1; }
echo "PASS: T001 — Implement src/commands/server.ts"
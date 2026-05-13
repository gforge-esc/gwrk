#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T041 — Implement src/commands/tasks.ts (Phase 10: ready)

test -f src/commands/tasks.ts \
  || { echo "FAIL: T041 — file not found: src/commands/tasks.ts" >&2; exit 1; }

grep -q '.command("ready' src/commands/tasks.ts \
  || { echo "FAIL: T041 — src/commands/tasks.ts missing 'ready' command" >&2; exit 1; }

echo "PASS: T041 — Implement src/commands/tasks.ts (ready)"

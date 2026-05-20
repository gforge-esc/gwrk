#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/tasks.ts \
  || { echo "FAIL: T021 — file not found: src/commands/tasks.ts" >&2; exit 1; }
grep -q 'tasksCommand' src/commands/tasks.ts \
  || { echo "FAIL: T021 — src/commands/tasks.ts missing 'tasksCommand'" >&2; exit 1; }

echo "PASS: T021 — Implement src/commands/tasks.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T015 — Implement src/commands/tasks-generate.ts

test -f src/commands/tasks-generate.ts \
  || { echo "FAIL: T015 — file not found: src/commands/tasks-generate.ts" >&2; exit 1; }

grep -q 'new Command("tasks")' src/commands/tasks-generate.ts \
  || { echo "FAIL: T015 — src/commands/tasks-generate.ts missing 'new Command(\"tasks\")'" >&2; exit 1; }

grep -q 'saveTaskState' src/commands/tasks-generate.ts \
  || { echo "FAIL: T015 — src/commands/tasks-generate.ts missing 'saveTaskState'" >&2; exit 1; }

echo "PASS: T015 — Implement src/commands/tasks-generate.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T021 — Implement src/commands/tasks.ts

test -f src/commands/tasks.ts \
  || { echo "FAIL: T021 — file not found: src/commands/tasks.ts" >&2; exit 1; }

grep -q 'new Command("tasks")' src/commands/tasks.ts \
  || { echo "FAIL: T021 — src/commands/tasks.ts missing 'new Command(\"tasks\")'" >&2; exit 1; }

grep -q 'markTaskComplete' src/commands/tasks.ts \
  || { echo "FAIL: T021 — src/commands/tasks.ts missing 'markTaskComplete'" >&2; exit 1; }

echo "PASS: T021 — Implement src/commands/tasks.ts"

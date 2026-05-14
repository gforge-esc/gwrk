#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T059 — Implement src/commands/tasks-generate.ts (quiet: true)

test -f src/commands/tasks-generate.ts \
  || { echo "FAIL: T059 — file not found: src/commands/tasks-generate.ts" >&2; exit 1; }

grep -q 'runtime.executeWorkflow' src/commands/tasks-generate.ts \
  || { echo "FAIL: T059 — src/commands/tasks-generate.ts missing 'runtime.executeWorkflow'" >&2; exit 1; }

echo "PASS: T059 — Implement src/commands/tasks-generate.ts"

#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T012 — Implement src/commands/specify.ts

test -f src/commands/specify.ts \
  || { echo "FAIL: T012 — file not found: src/commands/specify.ts" >&2; exit 1; }

grep -q 'new Command("spec")' src/commands/specify.ts \
  || { echo "FAIL: T012 — src/commands/specify.ts missing 'new Command(\"spec\")'" >&2; exit 1; }

grep -q 'WorkflowRuntime' src/commands/specify.ts \
  || { echo "FAIL: T012 — src/commands/specify.ts missing 'WorkflowRuntime'" >&2; exit 1; }

echo "PASS: T012 — Implement src/commands/specify.ts"

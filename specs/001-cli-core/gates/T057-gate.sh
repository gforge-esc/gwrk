#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T057 — Implement src/commands/specify.ts (quiet: true)

test -f src/commands/specify.ts \
  || { echo "FAIL: T057 — file not found: src/commands/specify.ts" >&2; exit 1; }

grep -q 'runtime.executeWorkflow' src/commands/specify.ts \
  || { echo "FAIL: T057 — src/commands/specify.ts missing 'runtime.executeWorkflow'" >&2; exit 1; }

echo "PASS: T057 — Implement src/commands/specify.ts"

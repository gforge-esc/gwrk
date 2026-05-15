#!/bin/bash
# AUTHORED
set -euo pipefail

test -f src/utils/agent-context.ts \
  || { echo "FAIL: T008 — file not found: src/utils/agent-context.ts" >&2; exit 1; }
grep -q 'buildProjectContext' src/utils/agent-context.ts \
  || { echo "FAIL: T008 — src/utils/agent-context.ts missing 'buildProjectContext'" >&2; exit 1; }

echo "PASS: T008 — Implement src/utils/agent-context.ts"

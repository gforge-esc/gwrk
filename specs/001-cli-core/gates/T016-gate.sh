#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T016 — Implement src/utils/agent.ts

test -f src/utils/agent.ts \
  || { echo "FAIL: T016 — file not found: src/utils/agent.ts" >&2; exit 1; }

grep -q 'export async function dispatchAgent' src/utils/agent.ts \
  || { echo "FAIL: T016 — src/utils/agent.ts missing 'dispatchAgent'" >&2; exit 1; }

grep -q 'export async function dispatchToAgent' src/utils/agent.ts \
  || { echo "FAIL: T016 — src/utils/agent.ts missing 'dispatchToAgent'" >&2; exit 1; }

echo "PASS: T016 — Implement src/utils/agent.ts"

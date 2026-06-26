#!/bin/bash
set -euo pipefail
# AUTHORED — updated: run.ts was renamed to runs.ts (plural)

test -f src/commands/runs.ts \
  || { echo "FAIL: T034 — file not found: src/commands/runs.ts" >&2; exit 1; }
grep -q 'runsCommand' src/commands/runs.ts \
  || { echo "FAIL: T034 — src/commands/runs.ts missing 'runsCommand'" >&2; exit 1; }

echo "PASS: T034 — Implement src/commands/runs.ts"

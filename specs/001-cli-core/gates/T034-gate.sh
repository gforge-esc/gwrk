#!/bin/bash
set -euo pipefail
# AUTHORED

test -f src/commands/run.ts \
  || { echo "FAIL: T034 — file not found: src/commands/run.ts" >&2; exit 1; }
grep -q 'runCommand' src/commands/run.ts \
  || { echo "FAIL: T034 — src/commands/run.ts missing 'runCommand'" >&2; exit 1; }

echo "PASS: T034 — Implement src/commands/run.ts"

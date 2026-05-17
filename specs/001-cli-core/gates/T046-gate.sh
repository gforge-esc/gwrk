#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T046 — Implement src/commands/tasks.ts (Examples)

test -f src/commands/tasks.ts \
  || { echo "FAIL: T046 — file not found: src/commands/tasks.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/tasks.ts \
  || { echo "FAIL: T046 — src/commands/tasks.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T046 — Implement src/commands/tasks.ts (Examples)"
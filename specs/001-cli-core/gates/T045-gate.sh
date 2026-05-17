#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T045 — Implement src/commands/define.ts (Examples)

test -f src/commands/define.ts \
  || { echo "FAIL: T045 — file not found: src/commands/define.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/define.ts \
  || { echo "FAIL: T045 — src/commands/define.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T045 — Implement src/commands/define.ts (Examples)"
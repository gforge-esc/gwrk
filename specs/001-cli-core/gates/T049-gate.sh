#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T049 — Implement src/commands/test.ts (Examples)

test -f src/commands/test.ts \
  || { echo "FAIL: T049 — file not found: src/commands/test.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/test.ts \
  || { echo "FAIL: T049 — src/commands/test.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T049 — Implement src/commands/test.ts (Examples)"
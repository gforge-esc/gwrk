#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T047 — Implement src/commands/measure.ts (Examples)

test -f src/commands/measure.ts \
  || { echo "FAIL: T047 — file not found: src/commands/measure.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/measure.ts \
  || { echo "FAIL: T047 — src/commands/measure.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T047 — Implement src/commands/measure.ts (Examples)"
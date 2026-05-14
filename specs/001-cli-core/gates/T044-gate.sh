#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T044 — Implement src/commands/ship.ts (Examples)

test -f src/commands/ship.ts \
  || { echo "FAIL: T044 — file not found: src/commands/ship.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/ship.ts \
  || { echo "FAIL: T044 — src/commands/ship.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T044 — Implement src/commands/ship.ts (Examples)"
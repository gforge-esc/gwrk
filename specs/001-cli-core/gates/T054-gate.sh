#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T054 — Implement src/commands/gate.ts (Examples)

test -f src/commands/gate.ts \
  || { echo "FAIL: T054 — file not found: src/commands/gate.ts" >&2; exit 1; }

grep -q "Examples:" src/commands/gate.ts \
  || { echo "FAIL: T054 — src/commands/gate.ts missing 'Examples:'" >&2; exit 1; }

echo "PASS: T054 — Implement src/commands/gate.ts (Examples)"
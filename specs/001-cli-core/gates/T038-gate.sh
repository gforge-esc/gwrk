#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T038 — Implement src/commands/tasks.ts (Phase 09: verify)

test -f src/commands/tasks.ts \
  || { echo "FAIL: T038 — file not found: src/commands/tasks.ts" >&2; exit 1; }

grep -q '.command("verify' src/commands/tasks.ts \
  || { echo "FAIL: T038 — src/commands/tasks.ts missing 'verify' command" >&2; exit 1; }

echo "PASS: T038 — Implement src/commands/tasks.ts (verify)"

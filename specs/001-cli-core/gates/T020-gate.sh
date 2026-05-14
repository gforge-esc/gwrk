#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T020 — Implement src/commands/implement.ts

test -f src/commands/implement.ts \
  || { echo "FAIL: T020 — file not found: src/commands/implement.ts" >&2; exit 1; }

grep -q 'new Command("implement")' src/commands/implement.ts \
  || { echo "FAIL: T020 — src/commands/implement.ts missing 'new Command(\"implement\")'" >&2; exit 1; }

grep -q 'implementAction' src/commands/implement.ts \
  || { echo "FAIL: T020 — src/commands/implement.ts missing 'implementAction'" >&2; exit 1; }

echo "PASS: T020 — Implement src/commands/implement.ts"

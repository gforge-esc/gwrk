#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T003 — Implement src/cli.ts

test -f src/cli.ts \
  || { echo "FAIL: T003 — file not found: src/cli.ts" >&2; exit 1; }

grep -q 'new Command()' src/cli.ts \
  || { echo "FAIL: T003 — src/cli.ts missing 'new Command()'" >&2; exit 1; }

grep -q '.name("gwrk")' src/cli.ts \
  || { echo "FAIL: T003 — src/cli.ts missing 'program.name(\"gwrk\")'" >&2; exit 1; }

echo "PASS: T003 — Implement src/cli.ts"

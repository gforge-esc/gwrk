#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T045 — Implement src/commands/tests-generate.ts

test -f src/commands/tests-generate.ts \
  || { echo "FAIL: T045 — file not found: src/commands/tests-generate.ts" >&2; exit 1; }

grep -q 'new Command("tests")' src/commands/tests-generate.ts \
  || { echo "FAIL: T045 — src/commands/tests-generate.ts missing 'new Command(\"tests\")'" >&2; exit 1; }

echo "PASS: T045 — Implement src/commands/tests-generate.ts"

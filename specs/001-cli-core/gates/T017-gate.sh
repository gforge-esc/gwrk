#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T017 — Implement src/utils/parser.ts

test -f src/utils/parser.ts \
  || { echo "FAIL: T017 — file not found: src/utils/parser.ts" >&2; exit 1; }

grep -q 'export function parsePlan' src/utils/parser.ts \
  || { echo "FAIL: T017 — src/utils/parser.ts missing 'parsePlan'" >&2; exit 1; }

echo "PASS: T017 — Implement src/utils/parser.ts"

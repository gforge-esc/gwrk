#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T051 — Implement src/commands/tests-generate.ts (resolveFeature)

test -f src/commands/tests-generate.ts \
  || { echo "FAIL: T051 — file not found: src/commands/tests-generate.ts" >&2; exit 1; }

grep -q "resolveFeature" src/commands/tests-generate.ts \
  || { echo "FAIL: T051 — src/commands/tests-generate.ts missing 'resolveFeature'" >&2; exit 1; }

echo "PASS: T051 — Implement src/commands/tests-generate.ts (resolveFeature)"
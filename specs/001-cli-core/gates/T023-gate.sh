#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T023 — Implement src/utils/gate-gen.ts

test -f src/utils/gate-gen.ts \
  || { echo "FAIL: T023 — file not found: src/utils/gate-gen.ts" >&2; exit 1; }

grep -q 'export function generateGateBrief' src/utils/gate-gen.ts \
  || { echo "FAIL: T023 — src/utils/gate-gen.ts missing 'generateGateBrief'" >&2; exit 1; }

grep -q 'export function generateRunner' src/utils/gate-gen.ts \
  || { echo "FAIL: T023 — src/utils/gate-gen.ts missing 'generateRunner'" >&2; exit 1; }

echo "PASS: T023 — Implement src/utils/gate-gen.ts"

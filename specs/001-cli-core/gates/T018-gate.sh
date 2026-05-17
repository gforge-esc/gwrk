#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T018 — Implement src/utils/exec.ts

test -f src/utils/exec.ts \
  || { echo "FAIL: T018 — file not found: src/utils/exec.ts" >&2; exit 1; }

grep -q 'export function run' src/utils/exec.ts \
  || { echo "FAIL: T018 — src/utils/exec.ts missing 'run'" >&2; exit 1; }

grep -q 'export function runGate' src/utils/exec.ts \
  || { echo "FAIL: T018 — src/utils/exec.ts missing 'runGate'" >&2; exit 1; }

echo "PASS: T018 — Implement src/utils/exec.ts"

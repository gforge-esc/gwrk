#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/utils/config.ts || { echo "FAIL: T027 — file not found: src/utils/config.ts" >&2; exit 1; }
grep -q 'server:' src/utils/config.ts || { echo "FAIL: T027 — src/utils/config.ts missing 'server' block" >&2; exit 1; }
grep -q 'parallelism:' src/utils/config.ts || { echo "FAIL: T027 — src/utils/config.ts missing 'parallelism' block" >&2; exit 1; }
echo "PASS: T027 — Implement src/utils/config.ts"

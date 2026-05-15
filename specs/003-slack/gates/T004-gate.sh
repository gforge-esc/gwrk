#!/bin/bash
set -euo pipefail
# AUTHORED
# Gate: T004 — Implement src/server/routes/notify.ts

test -f src/server/routes/notify.ts \
  || { echo "FAIL: T004 — file not found: src/server/routes/notify.ts" >&2; exit 1; }
grep -q 'define_spec_ready' src/server/routes/notify.ts \
  || { echo "FAIL: T004 — src/server/routes/notify.ts missing 'define_spec_ready'" >&2; exit 1; }
grep -q 'define_plan_ready' src/server/routes/notify.ts \
  || { echo "FAIL: T004 — src/server/routes/notify.ts missing 'define_plan_ready'" >&2; exit 1; }
echo "PASS: T004 — Implement src/server/routes/notify.ts"

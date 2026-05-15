#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/routes/status.ts || { echo "FAIL: T033 — file not found: src/server/routes/status.ts" >&2; exit 1; }
grep -q '/api/status' src/server/routes/status.ts || { echo "FAIL: T033 — src/server/routes/status.ts missing '/api/status' route" >&2; exit 1; }
echo "PASS: T033 — Implement src/server/routes/status.ts"

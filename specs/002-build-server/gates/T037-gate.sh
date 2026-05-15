#!/bin/bash
set -euo pipefail
# AUTHORED
test -f src/server/routes/health.ts || { echo "FAIL: T037 — file not found: src/server/routes/health.ts" >&2; exit 1; }
grep -q '/health' src/server/routes/health.ts || { echo "FAIL: T037 — src/server/routes/health.ts missing '/health' route" >&2; exit 1; }
echo "PASS: T037 — Implement src/server/routes/health.ts"

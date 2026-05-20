#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/routes/health.ts || { echo "FAIL: T005 — file not found: src/server/routes/health.ts" >&2; exit 1; }
grep -q "server.get(\"/health\"" src/server/routes/health.ts || { echo "FAIL: T005 — src/server/routes/health.ts missing '/health' route" >&2; exit 1; }
echo "PASS: T005 — Implement src/server/routes/health.ts"
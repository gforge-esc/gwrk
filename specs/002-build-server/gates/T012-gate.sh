#!/bin/bash
# AUTHORED
set -euo pipefail
test -f src/server/routes/status.ts || { echo "FAIL: T012 — file not found: src/server/routes/status.ts" >&2; exit 1; }
grep -q "fastify.get(\"/api/status\"" src/server/routes/status.ts || { echo "FAIL: T012 — src/server/routes/status.ts missing '/api/status' route" >&2; exit 1; }
echo "PASS: T012 — Implement src/server/routes/status.ts"
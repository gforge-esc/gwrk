#!/usr/bin/env bash
# Gate: T007 — Implement status API route
set -euo pipefail

# Assertion #1: src/server/routes/status.ts exists
test -f src/server/routes/status.ts || { echo "FAIL: src/server/routes/status.ts not found"; exit 1; }

# Assertion #2: status route function exported
grep -q "export.*statusRoutes" src/server/routes/status.ts || { echo "FAIL: statusRoutes function not exported"; exit 1; }

# Assertion #3: GET /api/status endpoint defined
grep -q "fastify.get('/api/status'" src/server/routes/status.ts || { echo "FAIL: GET /api/status route missing"; exit 1; }

# Assertion #4: route registered in src/server/index.ts
grep -q "statusRoutes" src/server/index.ts || { echo "FAIL: statusRoutes not registered in index.ts"; exit 1; }

echo "PASS: T007"

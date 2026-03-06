#!/usr/bin/env bash
# Gate: T018 — Implement dispatch API routes
set -euo pipefail

# Assertion #1: src/server/routes/dispatch.ts exists
test -f src/server/routes/dispatch.ts || { echo "FAIL: src/server/routes/status.ts not found"; exit 1; }

# Assertion #2: dispatch route function exported
grep -q "export.*dispatchRoutes" src/server/routes/dispatch.ts || { echo "FAIL: dispatchRoutes function not exported"; exit 1; }

# Assertion #3: POST /api/dispatch defined
grep -q "fastify.post('/api/dispatch'" src/server/routes/dispatch.ts || { echo "FAIL: POST /api/dispatch route missing"; exit 1; }

# Assertion #4: GET /api/dispatch/queue defined
grep -q "fastify.get('/api/dispatch/queue'" src/server/routes/dispatch.ts || { echo "FAIL: GET /api/dispatch/queue route missing"; exit 1; }

# Assertion #5: route registered in src/server/index.ts
grep -q "dispatchRoutes" src/server/index.ts || { echo "FAIL: dispatchRoutes not registered in index.ts"; exit 1; }

echo "PASS: T018"

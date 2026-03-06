#!/usr/bin/env bash
# Gate: T004 — Implement Fastify server bootstrap and lifecycle
set -euo pipefail

# Assertion #1: src/server/index.ts exists
test -f src/server/index.ts || { echo "FAIL: src/server/index.ts not found"; exit 1; }

# Assertion #2: startServer function exists and exports
grep -q "export.*startServer" src/server/index.ts || { echo "FAIL: startServer function not exported"; exit 1; }

# Assertion #3: stopServer function exists and exports
grep -q "export.*stopServer" src/server/index.ts || { echo "FAIL: stopServer function not exported"; exit 1; }

# Assertion #4: /health endpoint registered
grep -q "/health" src/server/index.ts || { echo "FAIL: /health route missing"; exit 1; }

# Assertion #5: writes PID during startup
grep -q "writePid" src/server/index.ts || { echo "FAIL: startServer does not write PID"; exit 1; }

echo "PASS: T004"

#!/usr/bin/env bash
# Gate: T004 — Create Fastify server bootstrap
# Contract: src/server/index.ts must export startServer and stopServer
set -euo pipefail

FILE="src/server/index.ts"
# Assertion #1
test -f "$FILE" || { echo "FAIL: $FILE not found"; exit 1; }

# Verify startServer export
# Assertion #2
grep -q 'export.*function startServer\|export async function startServer' "$FILE" || { echo "FAIL: startServer not exported"; exit 1; }

# Verify stopServer export
# Assertion #3
grep -q 'export.*function stopServer\|export async function stopServer' "$FILE" || { echo "FAIL: stopServer not exported"; exit 1; }

# Verify Fastify import
# Assertion #4
grep -q 'fastify\|Fastify' "$FILE" || { echo "FAIL: Fastify not imported"; exit 1; }

# Verify /health route
# Assertion #5
grep -q '/health' "$FILE" || { echo "FAIL: /health route not defined"; exit 1; }

# Verify PID file integration
# Assertion #6
grep -q 'writePid\|readPid\|removePid' "$FILE" || { echo "FAIL: PID file functions not referenced"; exit 1; }

# Verify SIGTERM/SIGINT handler
# Assertion #7
grep -q 'SIGTERM\|SIGINT' "$FILE" || { echo "FAIL: Signal handlers not registered"; exit 1; }

echo "PASS: T004"

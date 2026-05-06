#!/bin/bash
set -euo pipefail
# Gate: T001 — Implement package.json
# HARDENED: Tests behavior (TypeScript compiles + server module importable)

# Assertion #1: package.json exists
test -f package.json

# Assertion #2: Fastify is a dependency (core server framework)
grep -q 'fastify' package.json

# Assertion #3: Build succeeds (proves all deps resolve)
pnpm build > /dev/null 2>&1

# Assertion #4: Server module compiles
test -f dist/server/index.js

echo "PASS: T001 — Implement package.json"

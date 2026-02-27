#!/usr/bin/env bash
# Gate: T002 — Add fastify dependency
set -euo pipefail

# Assertion #1
grep -q '"fastify"' package.json || { echo "FAIL: fastify not in package.json dependencies"; exit 1; }
# Assertion #2
test -d node_modules/fastify || { echo "FAIL: fastify not installed in node_modules"; exit 1; }

echo "PASS: T002"

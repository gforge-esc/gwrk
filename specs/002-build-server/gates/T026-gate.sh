#!/bin/bash
set -euo pipefail
# AUTHORED
test -f package.json || { echo "FAIL: T026 — file not found: package.json" >&2; exit 1; }
jq -e '.dependencies.fastify' package.json > /dev/null || { echo "FAIL: T026 — package.json missing 'fastify'" >&2; exit 1; }
jq -e '.dependencies.dockerode' package.json > /dev/null || { echo "FAIL: T026 — package.json missing 'dockerode'" >&2; exit 1; }
echo "PASS: T026 — Implement package.json"

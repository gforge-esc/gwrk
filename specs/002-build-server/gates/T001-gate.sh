#!/usr/bin/env bash
# Gate: T001 — Setup server dependencies and ESM configuration
set -euo pipefail

# Assertion #1: fastify in package.json
grep -q '"fastify":' package.json || { echo "FAIL: fastify dependency not found in package.json"; exit 1; }

# Assertion #2: module is ESNext in tsconfig.json
grep -q '"module": "ESNext"' tsconfig.json || { echo "FAIL: tsconfig.json module not set to ESNext"; exit 1; }

# Assertion #3: moduleResolution is set to Node or Bundler
grep -q '"moduleResolution": "Node"\|"moduleResolution": "Bundler"\|"moduleResolution": "node"' tsconfig.json || { echo "FAIL: tsconfig.json moduleResolution not set correctly for ESM"; exit 1; }

echo "PASS: T001"

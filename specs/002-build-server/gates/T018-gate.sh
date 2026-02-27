#!/usr/bin/env bash
# Gate: T018 — Add dockerode dependency
set -euo pipefail

# Assertion #1
grep -q '"dockerode"' package.json || { echo "FAIL: dockerode not in package.json dependencies"; exit 1; }
# Assertion #2
grep -q '"@types/dockerode"' package.json || { echo "FAIL: @types/dockerode not in devDependencies"; exit 1; }
# Assertion #3
test -d node_modules/dockerode || { echo "FAIL: dockerode not installed"; exit 1; }

echo "PASS: T018"
